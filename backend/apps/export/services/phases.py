"""Canonical phase grouping for Shipments.

Maps Shipment status codes (the actual state-machine values) to higher-level
phase codes used by the Detail context strip, the Self/Shipment kanbans, and
KPI groupings.

PHASE_ORDER is the kanban column order, NOT the status-machine order. The
order reflects operational reality: documents preparation begins in `draft`
(PREP phase) and continues to "Tayyar" before the truck physically loads.
By the time a shipment is in `yuklenme`, its documents are already in motion.
The Shipment status state machine in services/shipment.py::TRANSITIONS is
unchanged — this module only governs how statuses are grouped for
visualization and reporting.

PLAN is a virtual phase: no shipment row sits in this status. It exists so
the Shipment Kanban can reserve a column for upcoming demand cards (handled
by a separate model in a future spec — currently a placeholder).
"""

PHASE_MAP: dict[str, str] = {
    'draft':            'PREP',
    'yuklenme':         'LOAD',
    'gumruk_girish':    'DOCS',
    'gumruk_chykysh':   'DOCS',
    'yola_chykdy':      'TRANSIT',
    'serhet_tm':        'TRANSIT',
    'serhet_gechdi':    'TRANSIT',
    'barysh_gumrugi':   'TRANSIT',
    'yolda':            'TRANSIT',
    'bardy':            'DEST',
    'satylyar':         'DEST',
    'satyldy':          'DEST',
    'hasabat':          'DEST',
    'tamamlandy':       'CLOSE',
}

PHASE_ORDER: list[str] = ['PLAN', 'PREP', 'DOCS', 'LOAD', 'TRANSIT', 'DEST', 'CLOSE']

PHASE_LABELS: dict[str, str] = {
    'PLAN':    'phase.plan',
    'PREP':    'phase.prep',
    'DOCS':    'phase.docs',
    'LOAD':    'phase.load',
    'TRANSIT': 'phase.transit',
    'DEST':    'phase.dest',
    'CLOSE':   'phase.close',
}


def get_phase(status_code: str | None) -> str:
    """Resolve a status code to its phase. Returns 'CLOSE' for unknown / None."""
    if not status_code:
        return 'CLOSE'
    return PHASE_MAP.get(status_code, 'CLOSE')


def resolve_phase_entry(shipment) -> 'datetime | None':
    """Find the datetime when the shipment entered its current phase.

    Walks the status_log (newest-first via Meta.ordering = ['-changed_at'])
    and finds the contiguous run of log entries whose status codes map to
    the same phase as the current status. Returns the changed_at of the
    oldest entry in that run — that is when the phase started.

    Requires status_log to be prefetched with select_related('status').
    Returns None if there are no status log entries.

    This is the canonical phase-entry resolver used by both
    ShipmentDetailSerializer.get_in_phase_seconds and
    BoardItemSerializer.get_time_in_phase_seconds.
    """
    current_code = shipment.status.code if shipment.status_id else None
    if not current_code:
        return None

    current_phase = get_phase(current_code)

    # status_log is prefetched (ordered newest-first by Meta.ordering).
    # We need select_related('status') on each log entry for the code lookup.
    logs = list(shipment.status_log.all())
    if not logs:
        return None

    # Walk from newest to oldest. Collect logs whose phase matches.
    # Stop at the first log that belongs to a different phase.
    phase_entry_time = None
    for log in logs:
        log_code = log.status.code if log.status_id else None
        log_phase = get_phase(log_code)
        if log_phase == current_phase:
            phase_entry_time = log.changed_at
        else:
            # First gap — stop (we want the earliest contiguous run)
            break

    return phase_entry_time
