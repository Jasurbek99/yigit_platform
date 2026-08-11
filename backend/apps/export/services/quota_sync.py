"""Quota usage auto-sync — keeps QuotaUsageRecord aligned with a shipment's firm splits.

Single source of truth for the rule:
    "a shipment's QuotaUsageRecord rows mirror its current firm splits, and
     they count immediately."

Called from:
- ShipmentViewSet.create (draft path) — when firm_splits arrive at create time
- ShipmentViewSet.set_firm_splits — when splits are replaced after creation

The two call sites must not diverge — per-firm kg (actual split weight,
default-kg fallback) and audit/log shape all live here.

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
from apps.export.services.export_code import parse_export_code_date

if TYPE_CHECKING:
    from apps.core.models import User
    from apps.export.models import Shipment


def invalidate_quota_caches() -> None:
    """Bust the FIFO + per-firm-balance caches for every product type.

    Canonical quota-cache buster — the single place that knows which keys go
    stale when quota consumption or issuance changes. Call after any change
    that could affect a firm's remaining balance:
        - issuing / editing / deleting a quota issuance
        - assigning / editing firm splits (auto-creates draft usage)
        - approving / unapproving a usage record
        - soft-deleting / restoring / cancelling a shipment
        - hard-deleting an approved usage row

    Both keys must be busted together: FIFO (approved-only consumption) backs
    the dashboard/issuance list, while quota_firm_balances (draft + approved
    committed) backs the Sheet firm-split editor's "no quota" hard-block — a
    firm-split or issuance change moves both, so busting only one leaves the
    Sheet showing a stale "no quota" state for up to the 60s TTL.

    Dashboard cache (quota_dashboard:*) is left to expire on its own 60s TTL
    — Django's default backend has no pattern-delete and the keys are
    parameterised by season/date range. Acceptable lag for the dashboard,
    not for these (which other writes read back immediately).

    Both key families are parameterised by season id since D11 — quota no
    longer crosses a season boundary, so each season has its own ledger and its
    own cache entry. Django's default backend has no pattern-delete, so this
    enumerates the seasons rather than globbing; the table holds one row per
    export year, so the id list is tiny and bounded.
    """
    from apps.core.models import Season

    season_ids = list(Season.objects.values_list('id', flat=True))
    cache.delete_many([
        f'{prefix}:{product}:{season_id}'
        for prefix in ('fifo_usage', 'quota_firm_balances')
        for product in ('tomato', 'pepper')
        for season_id in season_ids
    ])


def sync_draft_quota_usage_for_shipment(
    shipment: 'Shipment',
    user: 'User',
    product_type: str = 'tomato',
) -> int:
    """Replace this shipment's QuotaUsageRecord rows from its current firm splits.

    Reads the live ShipmentFirmSplit rows on the shipment, deletes its existing
    usage records, and bulk-creates one fresh row per split. kg_used mirrors each
    firm's actual split weight_kg, falling back to the admin-configurable
    TruckSplitDefault (see ADR-016) only when a split has no weight set.

    Rows are created `status='approved'` — they count the moment the truck has
    firm splits, with no review step. `approved_by` / `approved_at` stay NULL,
    which is the honest record: nothing was signed. Read `status='approved'` as
    "counted", not "a human checked this".

    This function therefore replaces EVERY row it finds, approved ones included.
    It used to refuse (`ApprovedQuotaExistsError`) when approved rows existed,
    because approved meant a document-team signature that automation must not
    overwrite. With the review step gone, every shipment-linked row is
    machine-generated from the splits, so the guard would have fired on every
    single split edit and 400'd it. Manually-entered rows are unaffected — they
    carry no shipment and are never in this queryset.

    Idempotent: calling twice with the same splits yields the same rows.

    Args:
        shipment: The Shipment whose firm_splits drive the usage records.
        user: User performing the action (audit: created_by on each row).
        product_type: Quota product type ('tomato' or 'pepper'). Defaults to 'tomato'
            — pepper support arrives when shipments carry product type.

    Returns:
        Number of QuotaUsageRecord rows created.
    """
    splits = list(shipment.firm_splits.values_list('export_firm_id', 'weight_kg'))
    num_firms = len(splits)

    # Drop the old rows FIRST — even with zero splits, stale rows must go.
    shipment.quota_usage_records.all().delete()

    if num_firms == 0:
        return 0

    # kg_used mirrors each firm's actual split weight. Editing a split's weight
    # reassigns that firm's quota usage to the new number. Fall back to the
    # admin TruckSplitDefault only when a split carries no weight (the input
    # serializer allows weight_kg to be omitted at create time).
    default_kg = get_default_truck_weight(num_firms)

    # usage_date = the real date encoded in the operator's export code
    # (e.g. 12JN121/26 → 12 Jun 2026). shipment.date is only the creation/import
    # day, so it's the fallback when the code is missing or unparseable.
    usage_date = parse_export_code_date(shipment.export_code) or shipment.date

    QuotaUsageRecord.objects.bulk_create(
        [
            QuotaUsageRecord(
                usage_date=usage_date,
                export_firm_id=firm_id,
                kg_used=weight_kg if weight_kg and weight_kg > 0 else default_kg,
                product_type=product_type,
                shipment=shipment,
                status='approved',
                created_by=user,
            )
            for firm_id, weight_kg in splits
        ],
        batch_size=500,
    )
    return num_firms
