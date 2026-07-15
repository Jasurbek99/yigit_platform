"""Write ShipmentBlockSource rows normalized to top-level (parent) blocks.

The greenhouse block tree is exactly one level deep (F1/F2 → F, OD/OG → O).
`block_sources` MUST be stored at PARENT grain because the weekly plan
(`HarvestDayEntry`) is keyed on top-level blocks (`parent__isnull=True`); a
sub-block source silently misses the `rollup_actuals_for_date` match. This module
is the single choke point every write site uses, so grain is normalized — and
sub-blocks merged into their parent — in exactly one place.
"""
from collections import OrderedDict
from decimal import Decimal

from django.db import transaction


def build_block_parent_map() -> dict[int, int]:
    """Map every block id to its top-level ancestor id (self when top-level)."""
    from apps.core.models import GreenhouseBlock
    return {
        b['id']: (b['parent_id'] or b['id'])
        for b in GreenhouseBlock.objects.values('id', 'parent_id')
    }


def _block_id(block) -> int:
    """Accept a GreenhouseBlock instance or a raw id and return the id."""
    return block.id if hasattr(block, 'id') else int(block)


def merge_to_parent(entries, parent_map: dict[int, int]) -> "OrderedDict[int, dict]":
    """Collapse (block, weight, harvest_date) entries to {parent_id: {...}}.

    Weights are summed; the first non-null harvest_date wins; input order is kept.
    Each entry is a dict with `block` (instance or id), `weight_kg`, and optional
    `harvest_date`.
    """
    merged: "OrderedDict[int, dict]" = OrderedDict()
    for entry in entries:
        top_id = parent_map.get(_block_id(entry['block']), _block_id(entry['block']))
        weight = Decimal(str(entry['weight_kg']))
        harvest_date = entry.get('harvest_date')
        if top_id in merged:
            merged[top_id]['weight_kg'] += weight
            if merged[top_id]['harvest_date'] is None and harvest_date:
                merged[top_id]['harvest_date'] = harvest_date
        else:
            merged[top_id] = {'weight_kg': weight, 'harvest_date': harvest_date}
    return merged


def write_block_sources(shipment, entries, *, replace: bool = True) -> int:
    """Normalize entries to parent grain, merge by parent, and write rows.

    Args:
        shipment: The Shipment to write block_sources for.
        entries: Iterable of {'block': instance|id, 'weight_kg', 'harvest_date'?}.
        replace: Delete existing block_sources first (default True).

    Returns:
        Number of ShipmentBlockSource rows written.
    """
    from apps.export.models import ShipmentBlockSource

    parent_map = build_block_parent_map()
    merged = merge_to_parent(entries, parent_map)
    with transaction.atomic():
        if replace:
            shipment.block_sources.all().delete()
        rows = [
            ShipmentBlockSource(
                shipment=shipment,
                block_id=top_id,
                weight_kg=data['weight_kg'],
                harvest_date=data['harvest_date'],
            )
            for top_id, data in merged.items()
        ]
        if rows:
            ShipmentBlockSource.objects.bulk_create(rows, batch_size=500)
    return len(rows)


def compute_block_variety_breakdown(shipment) -> list[dict]:
    """Per (top-level block × variety) net-weight breakdown from the pallet manifest.

    Sub-blocks are summed into their parent. This is the data the sales report's
    block-breakdown section is filled from (e.g. "MIDELICE, block F, 9143 kg").

    Returns a list sorted by block code then variety name, each item:
        {block_id, block_code, block_name, variety_id, variety_name, weight_kg}
    """
    from apps.core.models import GreenhouseBlock

    parent_map = build_block_parent_map()
    pallets = shipment.pallets.select_related('crate_type', 'variety')

    # (parent_block_id, variety_id) -> summed net weight
    agg: dict[tuple[int, int], Decimal] = {}
    variety_names: dict[int, str] = {}
    for pallet in pallets:
        top_id = parent_map.get(pallet.sub_block_id, pallet.sub_block_id)
        key = (top_id, pallet.variety_id)
        agg[key] = agg.get(key, Decimal('0')) + pallet.net_weight_kg
        variety_names[pallet.variety_id] = pallet.variety.name

    block_ids = {block_id for block_id, _ in agg}
    blocks = {
        b.id: b for b in GreenhouseBlock.objects.filter(id__in=block_ids)
    }

    rows = [
        {
            'block_id': block_id,
            'block_code': blocks[block_id].code if block_id in blocks else '',
            'block_name': (blocks[block_id].name or '') if block_id in blocks else '',
            'variety_id': variety_id,
            'variety_name': variety_names.get(variety_id, ''),
            'weight_kg': weight,
        }
        for (block_id, variety_id), weight in agg.items()
    ]
    rows.sort(key=lambda r: (r['block_code'], r['variety_name']))
    return rows
