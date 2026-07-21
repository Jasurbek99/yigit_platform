"""Team KPI leaderboard aggregation.

Placed in apps.core (like views_me) because it aggregates export-domain data
without being shipment-specific. Task is imported lazily to respect the
core ← export dependency direction.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from zoneinfo import ZoneInfo

from apps.core.models import User, WorkSessionDaily
from apps.core.roles import task_roles_for

_TM_TZ = ZoneInfo('Asia/Ashgabat')
_VALID_PERIODS = ('today', 'week', 'month', 'season')
_TREND_DAYS = 14


def parse_period(value: str | None) -> str:
    """Validate the period query param. Defaults to 'week'; raises on unknown."""
    if not value:
        return 'week'
    if value not in _VALID_PERIODS:
        raise ValueError(f'Unknown period: {value!r}')
    return value


def _local_midnight(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=_TM_TZ)


def period_window(period: str) -> tuple[datetime | None, date | None]:
    """Return (since_dt, since_date) for the given period in Asia/Ashgabat.

    since_dt gates Task.completed_at (a datetime); since_date gates
    WorkSessionDaily.work_date (a date). (None, None) means no lower bound
    (season with no active Season row).
    """
    now_local = timezone.now().astimezone(_TM_TZ)
    today = now_local.date()

    if period == 'today':
        start = today
    elif period == 'week':
        start = today - timedelta(days=today.weekday())      # Monday
    elif period == 'month':
        start = today.replace(day=1)
    else:  # season
        from apps.core.models import Season
        season = Season.objects.filter(is_active=True).order_by('-start_date').first()
        if season is None:
            return None, None
        start = season.start_date

    return _local_midnight(start), start


def compute_team_kpi(period: str) -> list[dict]:
    """Aggregate per-user KPI rows for the leaderboard.

    Three grouped queries (completions/on-time by completed_by, overdue by
    role, active-seconds by user) merged over the full active-user roster.
    """
    from apps.export.models import Task, TaskState

    since_dt, since_date = period_window(period)

    # 1. Completions + on-time, grouped by the crediting user.
    comp_filter = Q(state=TaskState.DONE, completed_by__isnull=False)
    if since_dt is not None:
        comp_filter &= Q(completed_at__gte=since_dt)
    comp_rows = (
        Task.objects.filter(comp_filter)
        .values('completed_by')
        .annotate(
            completed=Count('id'),
            with_deadline=Count('id', filter=Q(deadline__isnull=False)),
            on_time=Count('id', filter=Q(
                deadline__isnull=False, completed_at__lte=F('deadline'),
            )),
        )
    )
    comp_by_user = {r['completed_by']: r for r in comp_rows}

    # 2. Overdue NOW — current-state, window-independent, grouped by role.
    now = timezone.now()
    overdue_rows = (
        Task.objects.filter(deadline__lt=now)
        .exclude(state__in=[TaskState.DONE, TaskState.CANCELLED])
        .values('assignee_role')
        .annotate(c=Count('id'))
    )
    overdue_by_role = {r['assignee_role']: r['c'] for r in overdue_rows}

    # 3. Active seconds, grouped by user over the window.
    active_qs = WorkSessionDaily.objects.all()
    if since_date is not None:
        active_qs = active_qs.filter(work_date__gte=since_date)
    active_rows = active_qs.values('user_id').annotate(s=Sum('active_seconds_total'))
    active_by_user = {r['user_id']: int(r['s'] or 0) for r in active_rows}

    # 3b. 14-day daily completion trend per user (fixed window, TM-local days).
    now_local = timezone.now().astimezone(_TM_TZ)
    trend_start_date = now_local.date() - timedelta(days=_TREND_DAYS - 1)
    trend_since = _local_midnight(trend_start_date)
    trend_rows = (
        Task.objects.filter(
            state=TaskState.DONE,
            completed_by__isnull=False,
            completed_at__gte=trend_since,
        )
        .annotate(day=TruncDate('completed_at', tzinfo=_TM_TZ))
        .values('completed_by', 'day')
        .annotate(c=Count('id'))
    )
    # index: {user_id: {date: count}}
    trend_by_user: dict[int, dict] = {}
    for r in trend_rows:
        trend_by_user.setdefault(r['completed_by'], {})[r['day']] = r['c']
    trend_dates = [trend_start_date + timedelta(days=i) for i in range(_TREND_DAYS)]

    # 4. Roster merge.
    users = User.objects.filter(is_active=True).values(
        'id', 'username', 'first_name', 'last_name', 'role',
    )
    payload: list[dict] = []
    for u in users:
        full = ' '.join(
            p for p in [(u['first_name'] or '').strip(), (u['last_name'] or '').strip()] if p
        )
        comp = comp_by_user.get(u['id'])
        completed = comp['completed'] if comp else 0
        if comp and comp['with_deadline']:
            on_time_rate = round(comp['on_time'] / comp['with_deadline'], 4)
        else:
            on_time_rate = None
        overdue_now = sum(overdue_by_role.get(r, 0) for r in task_roles_for(u['role']))
        user_trend_map = trend_by_user.get(u['id'], {})
        trend = [int(user_trend_map.get(d, 0)) for d in trend_dates]
        payload.append({
            'user_id': u['id'],
            'user_name': full or u['username'],
            'role': u['role'],
            'completed': completed,
            'on_time_rate': on_time_rate,
            'overdue_now': overdue_now,
            'active_seconds': active_by_user.get(u['id'], 0),
            'trend': trend,
        })

    payload.sort(key=lambda r: (-r['completed'], r['user_name']))
    return payload
