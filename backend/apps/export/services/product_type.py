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


def set_shipment_product(shipment, product, user) -> bool:
    """Write the product with .update() (no auto-advance) and re-sync quota usage."""
    from apps.export.models import Shipment
    from apps.export.services.quota_sync import invalidate_quota_caches, sync_draft_quota_usage_for_shipment

    if product is None or shipment.product_type_id == product.id:
        return False
    Shipment.objects.filter(pk=shipment.pk).update(product_type=product)
    shipment.product_type = product
    if shipment.firm_splits.exists():
        sync_draft_quota_usage_for_shipment(shipment, user, product_type=product_code(product))
        transaction.on_commit(invalidate_quota_caches)
    return True
