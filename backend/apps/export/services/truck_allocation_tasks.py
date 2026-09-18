"""Saturday weekly-plan summary + truck-allocation task for the export manager.

Every Saturday 09:00 (Celery beat → apps.export.tasks.send_saturday_plan_summary),
for NEXT week's plan (due Friday):

1. send_weekly_plan_summary — one bell notification to every active
   export_manager, boss and director: the overall plan-fill % plus each
   greenhouse manager's %, worst first, with their incomplete blocks.
2. generate_truck_allocation_task — one role-wide export_manager Task to fill
   that week's truck allocation ("Maşyn paýlanyşy"), built like the seller's
   local_sell_plan task (assignee_user is null, anyone in the role can finish it).

Fill % counts Mon–Sat plan cells only (Sunday is not measured — same rule as
weekly_plan_tasks). The denominator is 6 × the manager's active block
assignments, NOT the rows that exist, so a week nobody initialized reads 0%.

The task auto-closes when every Mon–Sat day that needs a truck has at least one
split to a destination with truck_count > 0. A day "needs a truck" when its
planned kg rounds to ≥ 1 truck at 18,500 kg — the same capacity the truck table
shows (TruckAllocationTable.tsx trucksFromKg), so a light day the table shows as
0 trucks never blocks the task. At least one truck overall is required, so an
empty week cannot close it. Resolution is lazy, from the task-read path
(MeTaskListView), like the other plan tasks.

Lives in export (not greenhouse): it reads greenhouse plan cells and writes
export Tasks/Notifications — export may import greenhouse, not the reverse.
"""
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Count, Sum
from django.utils import timezone

from apps.export.models import Notification, Task, TaskCompletionRule, TaskKind, TaskState

logger = logging.getLogger(__name__)

ASSIGNEE_ROLE = 'export_manager'
TITLE_KEY = 'tasks.fill_truck_allocation'
STEP = 'truck_allocation'
NOTIFICATION_KIND = 'weekly_plan_summary'
SUMMARY_ROLES = ('export_manager', 'boss', 'director')
PLAN_DAYS = 6  # Mon–Sat
TRUCK_CAPACITY_KG = Decimal('18500')
MESSAGE_MAX_LEN = 500  # Notification.message max_length


@dataclass
class ManagerFill:
    user_id: int
    name: str
    filled: int
    total: int
    incomplete_blocks: list[str] = field(default_factory=list)

    @property
    def percent(self) -> int:
        # Floor, so 100% only ever means every cell is filled.
        return self.filled * 100 // self.total if self.total else 0


def _build_link(year: int, week: int) -> str:
    return f'/export/plan?week={week}&year={year}'


def _mon_sat(year: int, week: int) -> tuple[date, date]:
    monday = date.fromisocalendar(year, week, 1)
    return monday, monday + timedelta(days=PLAN_DAYS - 1)


def plan_fill_by_manager(year: int, week: int) -> list[ManagerFill]:
    """Return each greenhouse manager's Mon–Sat plan fill for the ISO week."""
    from apps.greenhouse.models import BlockManagerAssignment, HarvestDayEntry

    monday, saturday = _mon_sat(year, week)
    assignments = list(
        BlockManagerAssignment.objects
        .filter(is_active=True)
        .select_related('user', 'block')
        .order_by('block__code')
    )
    filled_by_block = dict(
        HarvestDayEntry.objects
        .filter(
            block_id__in={a.block_id for a in assignments},
            entry_date__range=(monday, saturday),
            plan_value__isnull=False,
        )
        .order_by()  # strip Meta.ordering so it doesn't join the GROUP BY
        .values('block_id')
        .annotate(n=Count('id'))
        .values_list('block_id', 'n')
    ) if assignments else {}

    fills: dict[int, ManagerFill] = {}
    for asn in assignments:
        fill = fills.get(asn.user_id)
        if fill is None:
            name = asn.user.get_full_name() or asn.user.username
            fill = fills[asn.user_id] = ManagerFill(user_id=asn.user_id, name=name, filled=0, total=0)
        block_filled = min(filled_by_block.get(asn.block_id, 0), PLAN_DAYS)
        fill.filled += block_filled
        fill.total += PLAN_DAYS
        if block_filled < PLAN_DAYS:
            fill.incomplete_blocks.append(asn.block.code)
    return list(fills.values())


def build_summary_message(year: int, week: int, fills: list[ManagerFill]) -> str:
    """'W39/2026: 78% · Maral 25% (B, C) · Toyly 100%' — worst first, ≤ 500 chars."""
    total = ManagerFill(user_id=0, name='', filled=sum(f.filled for f in fills),
                        total=sum(f.total for f in fills))
    message = f'W{week}/{year}: {total.percent}%'

    parts = []
    for f in sorted(fills, key=lambda f: (f.percent, f.name)):
        part = f'{f.name} {f.percent}%'
        if f.incomplete_blocks:
            part += f' ({", ".join(f.incomplete_blocks)})'
        parts.append(part)

    for i, part in enumerate(parts):
        remaining = len(parts) - i - 1
        suffix = f' · +{remaining}' if remaining else ''
        if len(message) + len(' · ') + len(part) + len(suffix) > MESSAGE_MAX_LEN:
            return f'{message} · +{len(parts) - i}'
        message += f' · {part}'
    return message


def send_weekly_plan_summary(year: int, week: int) -> int:
    """Notify export_manager/boss/director of next week's plan fill.

    Idempotent per (user, kind, link) — the link carries the week — so a re-run
    creates nothing. Returns the number of notifications created.
    """
    from apps.core.models import User

    link = _build_link(year, week)
    message = build_summary_message(year, week, plan_fill_by_manager(year, week))
    already = set(
        Notification.objects.filter(kind=NOTIFICATION_KIND, link=link).values_list('user_id', flat=True)
    )
    recipients = (
        User.objects
        .filter(role__in=SUMMARY_ROLES, is_active=True)
        .exclude(id__in=already)
        .values_list('id', flat=True)
    )
    created = Notification.objects.bulk_create(
        [Notification(user_id=uid, kind=NOTIFICATION_KIND, message=message, link=link) for uid in recipients],
        batch_size=500,
    )
    return len(created)


def generate_truck_allocation_task(year: int, week: int) -> list[Task]:
    """Create the shared export_manager truck_allocation Task for the ISO week.

    Idempotent: nothing is created if one already exists for (year, week) in any state.
    """
    if Task.objects.filter(kind=TaskKind.TRUCK_ALLOCATION, scope_year=year, scope_week=week).exists():
        return []

    task = Task.objects.create(
        shipment=None,
        kind=TaskKind.TRUCK_ALLOCATION,
        step=STEP,
        rule=None,
        title_key=TITLE_KEY,
        assignee_role=ASSIGNEE_ROLE,
        assignee_user=None,
        scope_block=None,
        completion_rule=TaskCompletionRule.MANUAL_DONE,
        link=_build_link(year, week),
        scope_year=year,
        scope_week=week,
        state=TaskState.OPEN,
    )
    logger.info('Generated truck_allocation task for W%d/%d', week, year)
    _resolve_task(task)
    return [task]


def _trucks_for_kg(kg: Decimal) -> int:
    # Half-up, matching the frontend's Math.round.
    return int((kg / TRUCK_CAPACITY_KG).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def _week_is_allocated(year: int, week: int) -> bool:
    from apps.export.models import TruckDestinationSplit
    from apps.greenhouse.models import HarvestDayEntry

    monday, saturday = _mon_sat(year, week)
    planned_kg = (
        HarvestDayEntry.objects
        .filter(entry_date__range=(monday, saturday), plan_value__isnull=False)
        .order_by()
        .values('entry_date')
        .annotate(kg=Sum('plan_value'))
        .values_list('entry_date', 'kg')
    )
    # WeeklyTruckAllocation.day_of_week is 1=Mon … 7=Sun.
    needs_trucks = {d.isoweekday() for d, kg in planned_kg if _trucks_for_kg(kg) >= 1}

    trucks = dict(
        TruckDestinationSplit.objects
        .filter(
            truck_allocation__year=year,
            truck_allocation__week_number=week,
            truck_allocation__day_of_week__lte=PLAN_DAYS,
        )
        .order_by()
        .values('truck_allocation__day_of_week')
        .annotate(n=Sum('truck_count'))
        .values_list('truck_allocation__day_of_week', 'n')
    )
    if sum(trucks.values()) == 0:
        return False
    return all(trucks.get(dow, 0) > 0 for dow in needs_trucks)


def _resolve_task(task: Task) -> bool:
    if task.scope_year is None or task.scope_week is None:
        return False
    if not _week_is_allocated(task.scope_year, task.scope_week):
        return False

    now = timezone.now()
    task.state = TaskState.DONE
    task.completed_at = now
    if not task.started_at:
        task.started_at = now
    task.save(update_fields=['state', 'completed_at', 'started_at'])
    return True


def resolve_truck_allocation_tasks() -> list[Task]:
    """Resolve every open truck_allocation task whose week is allocated.

    Called lazily from MeTaskListView. The open set is tiny (one task per week).
    """
    open_tasks = Task.objects.filter(
        kind=TaskKind.TRUCK_ALLOCATION,
        state__in=[TaskState.OPEN, TaskState.IN_PROGRESS],
    )
    return [t for t in open_tasks if _resolve_task(t)]


def run_saturday_plan_summary(today: date) -> None:
    """Summary + task for the plan week starting the Monday after `today`."""
    next_monday = today + timedelta(days=7 - today.weekday())
    year, week, _ = next_monday.isocalendar()
    sent = send_weekly_plan_summary(year, week)
    created = generate_truck_allocation_task(year, week)
    logger.info('Saturday plan summary W%d/%d: %d notifications, %d task(s)', week, year, sent, len(created))
