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
