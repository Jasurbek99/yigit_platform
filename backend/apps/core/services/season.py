"""Season lifecycle operations.

Closing does not move, delete, or modify any data row (D2) — it flips two
columns on the Season and lets the read scope hide the rest.
"""
from django.db import transaction
from django.utils import timezone

from apps.core.models import Season, User
from apps.core.seasons import get_active_season


def close_season(season: Season, user: User) -> None:
    """Freeze and hide `season`.

    Atomic: sets closed_at/closed_by and clears is_active. Does NOT touch any
    shipment, plan, or contract row — unfinished work stays unfinished and
    becomes visible again only when the season is explicitly selected.

    Confirmed not self-blocking: `Season` writes happen at the model layer
    (an instance `.save()`, not a queryset `.update()`), and neither
    write-freeze layer applies to `Season` itself — `freeze_season_of(a_
    season_instance)` returns None because `Season` has no `season`/`shipment`
    attribute and defines no `freeze_season` hook, so `assert_season_open()`
    is a no-op for it. If `Season` ever anchored to itself, closing one season
    would make it impossible to ever act on again.

    Args:
        season: The Season to close.
        user: The User performing the close; recorded on closed_by and in the
            audit log.

    Raises:
        ValueError: If `season` is already closed.
    """
    if season.is_closed:
        raise ValueError(f'Season {season.name} is already closed.')

    with transaction.atomic():
        season.closed_at = timezone.now()
        season.closed_by = user
        season.is_active = False
        season.save(update_fields=['closed_at', 'closed_by', 'is_active'])
        _audit(season, user, 'closed')


def open_season(season: Season, user: User) -> None:
    """Make `season` the write target.

    Atomic: deactivates the incumbent and activates `season` in one transaction,
    so `uq_season_single_active` is never transiently violated. The incumbent
    is always deactivated before `season` is activated, preserving that
    invariant.

    Args:
        season: The Season to activate.
        user: The User performing the open; recorded in the audit log.

    Raises:
        ValueError: If `season` is closed. Reopening is not supported — a
            season that can be reopened is not frozen, and every downstream
            report would have to assume its inputs can still change.
    """
    if season.is_closed:
        raise ValueError(
            f'Season {season.name} is closed and cannot be reopened.'
        )

    with transaction.atomic():
        # Find the incumbent through get_active_season() (apps.core.seasons),
        # the one legitimate lookup for "which season is active" — never an
        # ad-hoc filter here (see tests_seasons.NoAdHocActiveSeasonLookupTests).
        incumbent = get_active_season()
        if incumbent is not None and incumbent.pk != season.pk:
            incumbent.is_active = False
            incumbent.save(update_fields=['is_active'])
        season.is_active = True
        season.save(update_fields=['is_active'])
        _audit(season, user, 'opened')


def deactivate_season(season: Season, user: User) -> None:
    """Clear `season`'s write-target flag without closing it.

    The counterpart to `open_season()` for the `True -> False` half of the
    admin form's Active switch. It is NOT `close_season()`: nothing is frozen,
    `closed_at` stays NULL, and the season falls back to UPCOMING rather than
    CLOSED, so it can be opened again later.

    The result is the legitimate no-active-season gap — `get_active_season()`
    returns None and `apply_season_scope()` fails closed (D7). That is a
    consequential state to leave the platform in, which is the whole reason
    this is a service and not a bare `is_active = False` on the way past: it
    is the only place the audit row gets written.

    No "already inactive" guard, unlike `close_season()`: the single caller
    (`SeasonViewSet.perform_update`) only reaches here on an actual
    `True -> False` transition, and a redundant guard here would be dead code.

    Args:
        season: The Season to stand down.
        user: The User performing the change; recorded in the audit log.
    """
    with transaction.atomic():
        season.is_active = False
        season.save(update_fields=['is_active'])
        _audit(season, user, 'deactivated')


def close_preview(season: Season) -> dict[str, int]:
    """Counts of rows that closing `season` will hide.

    Advisory only — never blocks the close (D2). The confirmation dialog's copy
    is the entire mitigation for "14 trucks vanished from every board", so
    these numbers matter more than usual.

    Corrections against the real models (the brief guessed at these):
      - `WeeklyHarvestPlan.submitted_at` does not exist — it was dropped in
        greenhouse migration 0004 along with the wide plan/actual columns.
        Daily data now lives on `HarvestDayEntry` (plan_value/actual_value per
        day). `WeeklyHarvestPlan.locked_at` looked like the natural successor
        but has no writer anywhere in the codebase (grepped the full backend),
        so it would always be NULL and "unfinished_plans" would silently equal
        "every plan", which is not what a confirmation dialog can say. Instead
        this counts *plans with at least one day that has a plan_value but no
        actual_value yet* — i.e. harvest was planned but not yet reconciled.
      - `Task.completed_at` and `ShipmentStatusType.phase == 'COMPLETE'` are
        real (confirmed against `export/models/task.py` and migration
        `core.0010_state_machine_v2`) — kept as guessed.
      - `open_tasks` uses `Task.state` (OPEN/IN_PROGRESS/BLOCKED), not
        `completed_at__isnull=True`: cancelling a shipment sets a task's
        `state` to CANCELLED without ever setting `completed_at`
        (`_cancel_open_tasks` in `export/services/shipment.py`), so the
        brief's guess would have counted cancelled shipments' stale tasks as
        open work.
      - `in_transit` also excludes `phase='CANCELLED'` (migration
        `core.0011_add_cancelled_status`) for the same reason — a cancelled
        shipment is not "in transit".

    `draft_quota_usage` (added 2026-08-08) is the odd one out and the reason it
    is here: every other counter names work that is *hidden* and comes back
    read-only, but a quota-usage row still in `draft` can never be approved
    once its season closes — approving is a write to frozen data and there is
    no unfreeze. That consequence is created by the close and is irreversible,
    so the dialog is the only place it can be surfaced in time. It is counted
    through `usage_season_q()`, the same predicate the read scope and the FIFO
    ledger use, so no new "which season does this row belong to" rule enters
    the codebase.

    Args:
        season: The Season being previewed for closing.

    Returns:
        Dict with int values for keys: drafts, in_transit, open_tasks,
        unfinished_plans, draft_quota_usage. The first four are a fixed
        contract (frontend copy and tests interpolate them by name) — adding a
        key is safe, renaming or removing one is not.
    """
    from apps.export.models import QuotaUsageRecord, Shipment, Task, TaskState
    from apps.export.services_quota import usage_season_q
    from apps.greenhouse.models import WeeklyHarvestPlan

    shipments = Shipment.objects.filter(season=season, deleted_at__isnull=True, is_archived=False)
    open_tasks = Task.objects.filter(
        shipment__season=season,
        state__in=[TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED],
    )
    unfinished_plans = WeeklyHarvestPlan.objects.filter(
        season=season, day_entries__plan_value__isnull=False, day_entries__actual_value__isnull=True,
    ).distinct()
    return {
        'drafts': shipments.filter(status__code='draft').count(),
        'in_transit': shipments.exclude(status__code='draft')
        .exclude(status__phase__in=['COMPLETE', 'CANCELLED']).count(),
        'open_tasks': open_tasks.count(),
        'unfinished_plans': unfinished_plans.count(),
        'draft_quota_usage': QuotaUsageRecord.objects.filter(
            usage_season_q(season), status='draft',
        ).count(),
    }


def _audit(season: Season, user: User, action: str) -> None:
    """Write an AuditLog row for the lifecycle change.

    AuditLog currently lives in `export/` (root CLAUDE.md notes it is slated to
    move to core). The import is function-local so `core/` keeps a clean
    module-level import graph.

    Args:
        season: The Season being changed.
        user: The User performing the change.
        action: Past-tense verb for the detail line, e.g. 'closed' or 'opened'.
    """
    from apps.export.models import AuditLog

    AuditLog.objects.create(
        user=user,
        action='update',
        model_name='Season',
        object_id=season.pk,
        object_repr=season.name,
        field_name='status',
        detail=f'Season {action}',
    )
