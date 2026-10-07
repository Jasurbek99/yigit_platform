"""A shipment's product (tomato / pepper) — pepper spec 2026-10-05 §2.

The product is an explicit Shipment field. Supply-only rows take it from their
blocks; a destination plan (country + customer set) keeps it, because its
documents are prepared before the Join — so a block of another product is
refused there. NULL reads as tomato everywhere.
"""
from django.db import transaction

from apps.core.models import GreenhouseBlock, ProductType

MIXED_PRODUCT = 'mixed_product'
PRODUCT_MISMATCH = 'product_mismatch'


class ProductMismatchError(ValueError):
    """Message is MIXED_PRODUCT or PRODUCT_MISMATCH (frontend i18n keys errors.*)."""


class ProductQuotaError(ValueError):
    """A split firm has no quota for the product the truck is moving to (→ 400)."""


def product_code(product) -> str:
    return getattr(product, 'code', None) or ProductType.CODE_TOMATO


def shipment_product_code(shipment) -> str:
    return product_code(shipment.product_type)


def resolve_product_type(block_ids):
    blocks = GreenhouseBlock.objects.filter(id__in=list(block_ids)).select_related(
        'variety_main__product_type', 'parent__variety_main__product_type',
    )
    products = {p.id: p for p in (b.resolve_product() for b in blocks) if p is not None}
    if len(products) > 1:
        raise ProductMismatchError(MIXED_PRODUCT)
    return next(iter(products.values()), None)


def is_destination_plan(shipment) -> bool:
    return bool(shipment.country_id and shipment.customer_id)


def check_blocks_fit(shipment, block_ids):
    product = resolve_product_type(block_ids)
    if product is None or product.code == shipment_product_code(shipment):
        return None
    if is_destination_plan(shipment):
        raise ProductMismatchError(PRODUCT_MISMATCH)
    return product


def check_product_quota(shipment, product) -> None:
    """Refuse moving a split truck to a product a split firm has no quota for.

    Same hard block as set_firm_splits, against the shipment's own season. A
    change that keeps the effective code (NULL -> tomato) is not a quota move.
    """
    from apps.export.services_quota import compute_firm_quota_balances

    code = product_code(product)
    if code == shipment_product_code(shipment):
        return
    firms = [s.export_firm for s in shipment.firm_splits.select_related('export_firm')]
    if not firms:
        return
    balances = compute_firm_quota_balances(code, shipment.season)
    blocked = [
        f for f in firms
        if balances.get(f.id) is None or balances[f.id]['remaining_kg'] <= 0
    ]
    if blocked:
        names = ', '.join(f.name_short or f.code for f in blocked)
        raise ProductQuotaError(f'{names} has no remaining {code} quota.')


def set_shipment_product(shipment, product, user) -> bool:
    """Write the product with .update() (no auto-advance) and re-sync quota usage.

    Raises ProductQuotaError (nothing written) when a split firm lacks quota
    for the new product. Quota is re-synced only when the effective code moves.
    """
    from apps.export.models import Shipment
    from apps.export.services.quota_sync import invalidate_quota_caches, sync_draft_quota_usage_for_shipment

    if product is None or shipment.product_type_id == product.id:
        return False
    check_product_quota(shipment, product)
    code_moves = product_code(product) != shipment_product_code(shipment)
    Shipment.objects.filter(pk=shipment.pk).update(product_type=product)
    shipment.product_type = product
    if code_moves and shipment.firm_splits.exists():
        sync_draft_quota_usage_for_shipment(shipment, user, product_type=product_code(product))
        transaction.on_commit(invalidate_quota_caches)
    return True
