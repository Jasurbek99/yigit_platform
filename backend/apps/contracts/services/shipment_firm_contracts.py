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
from apps.export.models import PackingTemplateShare, Shipment, ShipmentFirmSplit

# Invoices at/above this settle through the bank; below, in cash. Non-blocking —
# surfaced as a warning so the operator can split a truck under the threshold.
USD_BANK_THRESHOLD = Decimal('10000')

# The per-firm packing an invoice prints. NET is not here: it is the firm's
# official quantity_kg (ADR-023), never a packing number.
FIRM_PACKING_FIELDS = ('gross_kg', 'box_count', 'pallet_count', 'pallet_weight_kg')

# A truck with no packing template has no per-firm gross / boxes / pallets to put
# on the sale, and the invoice would render those columns blank. Refuse the link
# and name the fix rather than producing a document the customs office rejects.
NO_TEMPLATE_MESSAGE = (
    'This truck has no packing template. Apply one in the packing panel first — '
    'the invoice needs the per-firm gross, boxes and pallets.'
)


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


def template_share_for(
    shipment: Shipment, export_firm_id: int, template=None
) -> PackingTemplateShare | None:
    """The applied PackingTemplate's share for one firm on this truck.

    The firm ↔ share mapping is POSITIONAL — the Nth firm split (by
    ``split_order``) takes the Nth share (by ``share_order``). That is the rule
    the apply-template endpoint writes with, so this returns exactly what
    applying the template would have put on the firm's sale. Both callers read
    it from here so the two can never drift apart and print firm B's boxes on
    firm A's invoice.

    Args:
        shipment: the truck.
        export_firm_id: the firm whose share is wanted.
        template: the template to read, for the apply endpoint, which resolves
            shares BEFORE it writes the FK onto the shipment. Defaults to the
            one already applied.

    Returns None when nothing can be resolved: no template, the firm is not on
    the truck, or the share count no longer matches the firm count (the splits
    changed after the template was applied).
    """
    template = template or shipment.packing_template
    if template is None:
        return None
    firms = list(
        shipment.firm_splits.order_by('split_order').values_list('export_firm_id', flat=True)
    )
    shares = list(template.shares.all())
    if len(shares) != len(firms) or export_firm_id not in firms:
        return None
    return shares[firms.index(export_firm_id)]


def _fill_packing_from_template(sale: ContractSale, shipment: Shipment) -> None:
    """Back-fill the sale's blank packing columns from the truck's template share.

    Applying a template copies each share onto the matching firm's sale, but that
    copy updates zero rows when the contract has not been linked yet — the sale
    does not exist. Nothing back-filled it afterwards, so an operator who picked
    the template before linking contracts got an invoice with no pieces, no gross
    and no pallet sentence.

    Only blanks are written: a value the operator typed for this truck in the
    packing panel outranks the catalog default and must survive a re-link.

    A share is packing cut for one particular net weight, so it is used only when
    that net still matches the firm's official quantity. It stops matching after
    a ``scope='swap'`` that could not move the packing because this firm had no
    sale yet: the swap exchanges the two weights but leaves ``split_order``
    alone, so the positional share now belongs to the other firm. Writing it
    would put a gross and a box count against a net they were never cut for —
    a wrong number on a customs document. Leaving the columns blank keeps the
    problem visible, and the operator fills them in the packing panel.
    """
    share = template_share_for(shipment, sale.export_firm_id)
    if share is None:
        return
    if share.net_kg is not None and sale.quantity_kg is not None and (
        share.net_kg != sale.quantity_kg
    ):
        return
    blanks = {
        field: getattr(share, field)
        for field in FIRM_PACKING_FIELDS
        if getattr(sale, field) is None
    }
    if not blanks:
        return
    ContractSale.objects.filter(pk=sale.pk).update(**blanks)
    for field, value in blanks.items():
        setattr(sale, field, value)


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
        ValueError: on missing buyer, no packing template, bad mode, or a
            contract_id that is not an active framework contract for this pair.
    """
    if shipment.import_firm_id is None:
        raise ValueError('Shipment has no buyer (import_firm); set it first.')

    split = _split_for(shipment, export_firm_id)
    if split is None:
        raise ValueError('No firm split for this export firm on the shipment.')

    if shipment.packing_template_id is None:
        raise ValueError(NO_TEMPLATE_MESSAGE)

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
    _fill_packing_from_template(sale, shipment)
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
