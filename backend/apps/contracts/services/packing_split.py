"""Derive per-firm packing from the whole-truck PackingPreset.

Poka-yoke: a firm's packing is the truck's config split by that firm's weight
share, so the per-firm values always sum back to the truck — you can't create an
inconsistent split. NET is never derived here (it is the firm's official weight),
and the gross/boxes/pallets derive proportionally. Each field may be overridden
per firm (a manual value on the ContractSale); null = use the derived value.
"""
from decimal import Decimal, ROUND_HALF_UP


def _scaled(value, ratio: Decimal, places: int):
    """value × ratio, rounded to `places` decimals; None passes through."""
    if value is None:
        return None
    quantum = Decimal(1).scaleb(-places)
    return (Decimal(value) * ratio).quantize(quantum, rounding=ROUND_HALF_UP)


def derive_firm_packing(truck_preset, firm_weight, total_weight) -> dict:
    """Return the derived {gross_kg, box_count, pallet_count, pallet_weight_kg}.

    ratio = firm_weight / total_weight. All None when inputs are missing.
    """
    empty = {'gross_kg': None, 'box_count': None, 'pallet_count': None, 'pallet_weight_kg': None}
    if truck_preset is None or not firm_weight or not total_weight:
        return empty
    ratio = Decimal(firm_weight) / Decimal(total_weight)
    box = None
    if truck_preset.box_count is not None:
        box = int((Decimal(truck_preset.box_count) * ratio).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    return {
        'gross_kg': _scaled(truck_preset.gross_kg, ratio, 2),
        'box_count': box,
        'pallet_count': _scaled(truck_preset.pallet_count, ratio, 1),
        'pallet_weight_kg': _scaled(truck_preset.pallet_weight_kg, ratio, 2),
    }


def effective_firm_packing(sale, truck_preset, firm_weight, total_weight) -> dict:
    """Per-field: the sale's override when set, else the derived value."""
    derived = derive_firm_packing(truck_preset, firm_weight, total_weight)
    return {
        field: (getattr(sale, field) if getattr(sale, field) is not None else derived[field])
        for field in ('gross_kg', 'box_count', 'pallet_count', 'pallet_weight_kg')
    }
