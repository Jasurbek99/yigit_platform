"""Quota usage auto-sync — keeps QuotaUsageRecord aligned with a shipment's firm splits.

Single source of truth for the rule:
    "draft QuotaUsageRecord rows mirror the shipment's current firm splits;
     approved rows are owned by the document team and never touched here."

Called from:
- ShipmentViewSet.create (draft path) — when firm_splits arrive at create time
- ShipmentViewSet.set_firm_splits — when splits are replaced after creation

The two call sites must not diverge — approved-record guard, default-kg
calculation, and audit/log shape all live here.

Soft-delete / cancel / restore do NOT touch rows here — the manager method
QuotaUsageRecord.objects.counted() handles those by filtering at aggregation
time. The caller only needs to call invalidate_quota_caches() so the cached
FIFO snapshot is recomputed.
"""
from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from django.core.cache import cache

from apps.export.models import QuotaUsageRecord
from apps.export.models.quota import get_default_truck_weight

if TYPE_CHECKING:
    from apps.core.models import User
    from apps.export.models import Shipment


class ApprovedQuotaExistsError(Exception):
    """Raised when caller tries to resync usage but approved rows already exist."""


def invalidate_quota_caches() -> None:
    """Bust FIFO cache for every product type.

    Call after any change that could affect quota consumption:
        - approving / unapproving a usage record
        - soft-deleting / restoring / cancelling a shipment
        - hard-deleting an approved usage row

    Dashboard cache (quota_dashboard:*) is left to expire on its own 60s TTL
    — Django's default backend has no pattern-delete and the keys are
    parameterised by season/date range. Acceptable lag for the dashboard,
    not for FIFO (which other writes read back immediately).
    """
    # Mirrors keys touched by QuotaUsageViewSet.approve.
    cache.delete('fifo_usage:tomato')
    cache.delete('fifo_usage:pepper')


def sync_draft_quota_usage_for_shipment(
    shipment: 'Shipment',
    user: 'User',
    product_type: str = 'tomato',
) -> int:
    """Replace this shipment's draft QuotaUsageRecord rows from its current firm splits.

    Reads the live ShipmentFirmSplit rows on the shipment, deletes existing draft
    usage records for the shipment, and bulk-creates one fresh draft per split
    using the per-firm kg from TruckSplitDefault (admin-configurable, see ADR-016).

    Approved records are NEVER deleted — they represent quota the document team
    already counted. If any exist for this shipment, the caller is asked to
    delete them via /quota-usage/{id}/ first (raises ApprovedQuotaExistsError).

    Idempotent: calling twice with the same splits yields the same draft rows.

    Args:
        shipment: The Shipment whose firm_splits drive the usage records.
        user: User performing the action (audit: created_by on each row).
        product_type: Quota product type ('tomato' or 'pepper'). Defaults to 'tomato'
            — pepper support arrives when shipments carry product type.

    Returns:
        Number of draft QuotaUsageRecord rows created.

    Raises:
        ApprovedQuotaExistsError: If approved usage rows exist for this shipment.
            Caller should surface a 400 with the firm-splits message.
    """
    if shipment.quota_usage_records.filter(status='approved').exists():
        raise ApprovedQuotaExistsError(
            'Cannot resync quota usage: approved records exist on this shipment. '
            'Delete them first via /quota-usage/{id}/.'
        )

    splits = list(shipment.firm_splits.values_list('export_firm_id', flat=True))
    num_firms = len(splits)

    # Drop drafts FIRST — even when there are zero splits, stale drafts must go.
    shipment.quota_usage_records.filter(status='draft').delete()

    if num_firms == 0:
        return 0

    per_firm_kg = get_default_truck_weight(num_firms)

    QuotaUsageRecord.objects.bulk_create(
        [
            QuotaUsageRecord(
                usage_date=shipment.date,
                export_firm_id=firm_id,
                kg_used=per_firm_kg,
                product_type=product_type,
                shipment=shipment,
                status='draft',
                created_by=user,
            )
            for firm_id in splits
        ],
        batch_size=500,
    )
    return num_firms
