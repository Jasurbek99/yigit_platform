"""Slice 4 — link a shipment's firm splits to contracts (the ADR-023 bridge).

A shipment's firm split (export.ShipmentFirmSplit, one export firm's share of a
truck) is bridged to a Contract via a ContractSale row keyed by
``(shipment, export_firm)``. For each split the operator either:
  - links the split to an existing **framework** contract of the (seller, buyer)
    pair, or
  - creates a new **one_time** contract (auto-numbered, no passport).

The invoice number/date are left blank — a person fills them at document time.

This lives in ``contracts`` (which may import ``export``); the export-side
firm-split code must never call into contracts (dependency direction).
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import transaction

from apps.contracts.models import Contract, ContractSale
from apps.contracts.services.contract_number import next_contract_no
from apps.core.models import ExportFirm
from apps.export.models import Shipment, ShipmentFirmSplit

# Invoices at/above this settle through the bank; below, in cash. Non-blocking —
# surfaced as a warning so the operator can split a truck under the threshold.
USD_BANK_THRESHOLD = Decimal('10000')


def money_warning(amount_usd) -> str | None:
    """Return 'bank' / 'cash' hint for the $10K rule, or None when unknown."""
    if amount_usd is None:
        return None
    return 'bank' if Decimal(amount_usd) >= USD_BANK_THRESHOLD else 'cash'


def framework_contracts_for_pair(export_firm_id: int, import_firm_id: int):
    """Active framework contracts for a (seller, buyer) pair, newest first."""
    return Contract.objects.filter(
        export_firm_id=export_firm_id,
        import_firm_id=import_firm_id,
        contract_type=Contract.TYPE_FRAMEWORK,
        status=Contract.STATUS_ACTIVE,
    ).order_by('-contract_year', '-seq', '-created_at')


def _split_for(shipment: Shipment, export_firm_id: int) -> ShipmentFirmSplit | None:
    return ShipmentFirmSplit.objects.filter(
        shipment=shipment, export_firm_id=export_firm_id
    ).first()


@transaction.atomic
def link_split_to_contract(
    *,
    shipment: Shipment,
    export_firm_id: int,
    mode: str,
    contract_id: int | None,
    user,
) -> ContractSale:
    """Create/update the (shipment, export_firm) → contract bridge sale.

    Args:
        shipment: the export.Shipment.
        export_firm_id: the split's export firm.
        mode: 'framework' (link to ``contract_id``) or 'one_time' (create new).
        contract_id: required when mode == 'framework'.
        user: actor (for one_time created_by).

    Raises:
        ValueError: on missing buyer, bad mode, or a contract_id that is not an
            active framework contract for this pair.
    """
    if shipment.import_firm_id is None:
        raise ValueError('Shipment has no buyer (import_firm); set it first.')

    split = _split_for(shipment, export_firm_id)
    if split is None:
        raise ValueError('No firm split for this export firm on the shipment.')

    if mode == 'framework':
        if not contract_id:
            raise ValueError('contract_id is required for framework mode.')
        contract = framework_contracts_for_pair(
            export_firm_id, shipment.import_firm_id
        ).filter(pk=contract_id).first()
        if contract is None:
            raise ValueError(
                'contract_id is not an active framework contract for this pair.'
            )
    elif mode == 'one_time':
        contract = _create_one_time_contract(shipment, export_firm_id, user)
    else:
        raise ValueError(f"Unknown mode '{mode}'.")

    sale, _created = ContractSale.objects.update_or_create(
        shipment=shipment,
        export_firm_id=export_firm_id,
        defaults={
            'contract': contract,
            'import_firm_id': shipment.import_firm_id,
            'quantity_kg': split.weight_kg,
            'total_usd': split.amount_usd,
            # invoice_number / invoice_date stay NULL — filled later by a person.
        },
    )
    return sale


def _create_one_time_contract(shipment: Shipment, export_firm_id: int, user) -> Contract:
    """Create a one_time contract for the pair, auto-numbered, no passport."""
    contract_date = shipment.date or datetime.date.today()
    export_firm = ExportFirm.objects.get(pk=export_firm_id)
    seq, year, number = next_contract_no(export_firm, contract_date)
    return Contract.objects.create(
        contract_number=number,
        seq=seq,
        contract_year=year,
        contract_type=Contract.TYPE_ONE_TIME,
        export_firm_id=export_firm_id,
        import_firm_id=shipment.import_firm_id,
        season=shipment.season,
        start_date=contract_date,
        planned_trucks=1,
        status=Contract.STATUS_ACTIVE,
        created_by=user,
    )
