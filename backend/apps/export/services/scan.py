"""Pallet QR scan: which trigger timestamp a scan of this shipment would record.

A scan never calls transition_to(). It fills the current step's trigger field
(the one its open Task is waiting on) through the normal Sheet write path, and
Shipment.save() → auto_advance_if_ready() moves the status. Reading the field
from the open Task, not a hardcoded map, keeps the has_peregruz fork and any
admin edit of the task rules in play.
"""
from typing import Optional

from apps.export.models import Shipment, TaskCompletionRule, TaskState

# Statuses a scan may move a shipment out of — from departure up to satyldy.
# The satyldy → tamamlandy close is finance work, not a pallet event.
SCAN_STEPS = frozenset({
    'yola_chykdy', 'serhet_gechdi', 'dest_entry', 'barysh_gumrugi',
    'transshipment', 'bardy', 'satylyar',
})

# Only physical-event timestamps. `city` (also open at bardy) stays on the Sheet.
SCAN_FIELDS = frozenset({
    'border_crossed_at', 'dest_entry_at', 'customs_entry_at', 'peregruz_date',
    'arrived_at', 'sale_started_at', 'sale_ended_at',
})


def scan_target_field(shipment: Shipment) -> Optional[str]:
    """Return the empty trigger field a scan would fill now, or None."""
    code = shipment.status.code if shipment.status_id else None
    if code not in SCAN_STEPS:
        return None
    open_tasks = (
        shipment.tasks
        .filter(step=code, state__in=[TaskState.OPEN, TaskState.IN_PROGRESS])
        .exclude(completion_rule=TaskCompletionRule.MANUAL_DONE)
        .order_by('pk')
    )
    for task in open_tasks:
        for field in task.target_field_list:
            if field in SCAN_FIELDS and getattr(shipment, field) is None:
                return field
    return None
