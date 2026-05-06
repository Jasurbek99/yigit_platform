"""KPI helper functions for the YGT Platform operational dashboard.

All helpers are pull-based (called on demand by API endpoints) and use
Django's cache framework to avoid repeated DB queries. Cache TTLs are
conservative — the boss dashboard polls every 60 seconds so a 60-second
TTL on most helpers means at most one DB query per poll.

MSSQL rules enforced throughout:
  - No JSONField, no ArrayField, no DISTINCT ON
  - DecimalField arithmetic only where money is involved
  - No subquery wrapping with inherited Meta.ordering (none needed here)
  - bulk_update with batch_size=500 (not used in read-only helpers)
"""
import logging
from datetime import timedelta

from django.core.cache import cache
from django.db.models import F, Q
from django.utils import timezone

logger = logging.getLogger(__name__)

# Cache TTL for helpers that are relatively expensive (multi-table joins).
_TTL_SHORT = 60   # seconds — throughput, cycle-time, stuck, blocked
_TTL_MEDIUM = 300  # seconds — avg_phase_time (inner cache matches detail serializer)


def _cache_key(name: str, *parts) -> str:
    """Build a namespaced cache key."""
    return f'kpi:{name}:{":".join(str(p) for p in parts)}'


# ---------------------------------------------------------------------------
# kpi_throughput
# ---------------------------------------------------------------------------

def kpi_throughput(window_days: int = 7) -> dict:
    """Count closed and created shipments in the last N days.

    Closed = status.code == 'tamamlandy' and status_changed_at in window.
    Created = created_at in window.

    Result is cached for 60 seconds.

    Args:
        window_days: Look-back window in days (default 7).

    Returns:
        Dict with keys: closed_count, created_count, window_days.
    """
    cache_key = _cache_key('throughput', window_days)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    from apps.export.models import Shipment

    since = timezone.now() - timedelta(days=window_days)
    closed_count = Shipment.objects.filter(
        status__code='tamamlandy',
        status_changed_at__gte=since,
    ).count()
    created_count = Shipment.objects.filter(created_at__gte=since).count()

    result = {
        'closed_count': closed_count,
        'created_count': created_count,
        'window_days': window_days,
    }
    cache.set(cache_key, result, _TTL_SHORT)
    return result


# ---------------------------------------------------------------------------
# kpi_cycle_time
# ---------------------------------------------------------------------------

def kpi_cycle_time(window_days: int = 30) -> dict:
    """Average end-to-end cycle time (created → tamamlandy) for shipments closed in window.

    Only counts shipments with both created_at and status_changed_at set.

    Args:
        window_days: Look-back window in days (default 30).

    Returns:
        Dict with keys: avg_seconds (int), count (int), window_days (int).
    """
    cache_key = _cache_key('cycle_time', window_days)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    from apps.export.models import Shipment

    since = timezone.now() - timedelta(days=window_days)
    closed = list(
        Shipment.objects
        .filter(status__code='tamamlandy', status_changed_at__gte=since)
        .values_list('created_at', 'status_changed_at')
    )
    durations = [
        (end - start).total_seconds()
        for start, end in closed
        if end and start
    ]
    result = {
        'avg_seconds': int(sum(durations) / len(durations)) if durations else 0,
        'count': len(durations),
        'window_days': window_days,
    }
    cache.set(cache_key, result, _TTL_SHORT)
    return result


# ---------------------------------------------------------------------------
# kpi_avg_phase_time
# ---------------------------------------------------------------------------

def kpi_avg_phase_time(window_days: int = 30) -> dict:
    """Average seconds spent per phase, derived from consecutive ShipmentStatusLog pairs.

    For each shipment with logs in the window, walks consecutive log pairs.
    Time (next.changed_at − current.changed_at) is attributed to the phase
    of current.status.code. Returns {phase_code: avg_seconds_int}.

    Phases with no historical data are absent from the result (not 0).
    Cached for 5 minutes (matches ShipmentDetailSerializer.get_phase_avg_seconds TTL).

    Args:
        window_days: Look-back window in days (default 30).

    Returns:
        Dict mapping phase code strings to average duration ints.
    """
    cache_key = _cache_key('avg_phase_time', window_days)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    from apps.export.models import ShipmentStatusLog
    from apps.export.services.phases import get_phase

    since = timezone.now() - timedelta(days=window_days)
    # Fetch all log entries in the window, ordered for shipment-grouped walk.
    # .order_by() on the outer queryset prevents MSSQL subquery-ordering issues
    # but here we need explicit ordering for the pair-walking logic.
    logs = list(
        ShipmentStatusLog.objects
        .filter(changed_at__gte=since)
        .select_related('status')
        .order_by('shipment_id', 'changed_at')
    )

    by_shipment: dict[int, list] = {}
    for log in logs:
        by_shipment.setdefault(log.shipment_id, []).append(log)

    phase_totals: dict[str, list[float]] = {}
    for _sid, shipment_logs in by_shipment.items():
        for i, current in enumerate(shipment_logs[:-1]):
            next_log = shipment_logs[i + 1]
            phase = get_phase(current.status.code if current.status_id else None)
            seconds = (next_log.changed_at - current.changed_at).total_seconds()
            if seconds > 0:
                phase_totals.setdefault(phase, []).append(seconds)

    result = {
        phase: int(sum(durs) / len(durs))
        for phase, durs in phase_totals.items()
        if durs
    }
    cache.set(cache_key, result, _TTL_MEDIUM)
    return result


# ---------------------------------------------------------------------------
# kpi_on_time_rate
# ---------------------------------------------------------------------------

def kpi_on_time_rate(role: str | None = None, window_days: int = 7) -> float | None:
    """Fraction of completed tasks that met their deadline.

    Returns None when no done tasks with deadlines exist in the window.
    Role filter is applied when role is provided.

    Args:
        role: Optional assignee_role string to scope the result.
        window_days: Look-back window in days (default 7).

    Returns:
        Float in [0, 1] rounded to 4 decimal places, or None.
    """
    from apps.export.models import Task, TaskState

    since = timezone.now() - timedelta(days=window_days)
    qs = Task.objects.filter(
        state=TaskState.DONE,
        completed_at__gte=since,
        deadline__isnull=False,
    )
    if role:
        qs = qs.filter(assignee_role=role)
    total = qs.count()
    if total == 0:
        return None
    on_time = qs.filter(completed_at__lte=F('deadline')).count()
    return round(on_time / total, 4)


# ---------------------------------------------------------------------------
# kpi_avg_task_duration
# ---------------------------------------------------------------------------

def kpi_avg_task_duration(role: str | None = None, window_days: int = 7) -> int:
    """Average seconds from started_at to completed_at for done tasks in window.

    Returns 0 when there are no qualifying tasks.

    Args:
        role: Optional assignee_role string to scope the result.
        window_days: Look-back window in days (default 7).

    Returns:
        Integer seconds (average), or 0.
    """
    from apps.export.models import Task, TaskState

    since = timezone.now() - timedelta(days=window_days)
    qs = Task.objects.filter(
        state=TaskState.DONE,
        completed_at__gte=since,
        started_at__isnull=False,
    )
    if role:
        qs = qs.filter(assignee_role=role)
    rows = list(qs.values_list('started_at', 'completed_at'))
    if not rows:
        return 0
    seconds = [(end - start).total_seconds() for start, end in rows if end and start]
    return int(sum(seconds) / len(seconds)) if seconds else 0


# ---------------------------------------------------------------------------
# kpi_stuck_shipments
# ---------------------------------------------------------------------------

def kpi_stuck_shipments(threshold_days: int = 8) -> int:
    """Count non-terminal, non-archived shipments with no recent status or task progress.

    'No progress' is defined as:
      - status_changed_at is older than threshold_days, AND
      - either the shipment has no tasks with started_at, OR
        all its tasks have started_at older than threshold_days.

    Note: the Q(tasks__started_at__isnull=True) | Q(tasks__started_at__lt=cutoff)
    filter matches a shipment if ANY task satisfies the condition, not ALL tasks.
    This matches the spec's intent for shipments where no meaningful task activity
    has occurred, but may over-count shipments with mixed (recent + stale) tasks.
    See plan § "Stream E" for the documented trade-off.

    Archived and terminal (tamamlandy) shipments are excluded.

    Args:
        threshold_days: Inactivity threshold in days (default 8).

    Returns:
        Integer count of stuck shipments.
    """
    from apps.export.models import Shipment

    cutoff = timezone.now() - timedelta(days=threshold_days)
    return (
        Shipment.objects
        .exclude(status__code='tamamlandy')
        .exclude(is_archived=True)
        .filter(status_changed_at__lt=cutoff)
        .filter(
            Q(tasks__started_at__isnull=True) |
            Q(tasks__started_at__lt=cutoff)
        )
        .distinct()
        .count()
    )


# ---------------------------------------------------------------------------
# kpi_blocked_age
# ---------------------------------------------------------------------------

def kpi_blocked_age() -> dict:
    """Statistics on currently-blocked tasks: avg, max, p95 age in seconds.

    'Age' is measured from started_at (if set) or created_at otherwise,
    to now. This approximates how long the task has been in a blocked state
    since we don't record a per-state-change timestamp on Task.

    Returns:
        Dict with keys: count (int), avg_seconds (int), max_seconds (int),
        p95_seconds (int). All zero when there are no blocked tasks.
    """
    from apps.export.models import Task, TaskState

    blocked = list(
        Task.objects
        .filter(state=TaskState.BLOCKED)
        .values_list('id', 'created_at', 'started_at')
    )
    if not blocked:
        return {'count': 0, 'avg_seconds': 0, 'max_seconds': 0, 'p95_seconds': 0}

    now = timezone.now()
    ages = [
        (now - (started_at or created_at)).total_seconds()
        for _task_id, created_at, started_at in blocked
    ]
    ages.sort()
    p95_idx = max(0, int(len(ages) * 0.95) - 1)
    return {
        'count': len(ages),
        'avg_seconds': int(sum(ages) / len(ages)),
        'max_seconds': int(ages[-1]),
        'p95_seconds': int(ages[p95_idx]),
    }
