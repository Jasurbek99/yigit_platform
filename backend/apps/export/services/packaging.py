"""Packing part (план поставки / Üpjünçilik bölegi): where it may move, and how.

Spec: docs/superpowers/specs/2026-09-29-packaging-join-board-design.md

The packing part is PACKING_FIELDS plus the shipment's block_sources and
varieties_dominant. It always lives on the Shipment row that currently carries
it; join / unjoin / swap move it between rows. Nothing in this module changes a
status — transition_to() stays the only path for that.
"""
from apps.export.models import Shipment

# Statuses in which packing may still be joined, detached or swapped.
PRE_LOADING = frozenset({'draft', 'gumruk_girish', 'gumruk_chykysh'})

PACKING_NOT_JOINED = (
    'Packing not joined: join a supply plan to this shipment before loading starts.'
)


def has_packing(shipment: Shipment) -> bool:
    """True when the shipment carries at least one block source."""
    return shipment.block_sources.exists()


def needs_packing_for_loading(shipment: Shipment) -> bool:
    """True when loading cannot be recorded yet: pre-loading row, no packing.

    Rows at yuklenme or later are never checked — legacy Excel imports may have
    no block_sources at all, and editing their loading time must keep working.
    """
    code = shipment.status.code if shipment.status_id else None
    return code in PRE_LOADING and not has_packing(shipment)
