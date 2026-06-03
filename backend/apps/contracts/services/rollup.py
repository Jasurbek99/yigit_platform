"""Contract denormalization rollup.

Single source of truth for writing the denormalized totals on Contract:
    exported_trucks, exported_quantity_kg, exported_amount_usd,
    payment_received_usd, remaining_usd.

Called from Invoice.save / Invoice.delete (Slice B) and will be called
from InvoicePayment.save / delete (Slice C). Never write these fields
directly anywhere else — Contract has an AD-1-style invariant that only
this function may touch them.

Excludes invoices with status='void' from all aggregates.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Max, Sum


def rollup_contract_totals(contract_id: int) -> None:
    """Recompute and persist the denormalized totals for a contract.

    Aggregates all non-void invoices for the contract and writes
    the five denormalized fields atomically inside a transaction.

    Uses ``Contract.objects.filter(...).update(...)`` to bypass
    Contract.save() and avoid re-triggering the placeholder formula.
    This is the canonical write path — no code outside this function
    should write Contract's exported_* or remaining_usd fields.

    Args:
        contract_id: Primary key of the Contract to recompute.
    """
    # Import here to avoid the circular import: models imports this service,
    # so a top-level import of Contract would fail at module load time.
    from apps.contracts.models import Contract, Invoice

    with transaction.atomic():
        # Lock the contract row to prevent concurrent rollup races
        contract = Contract.objects.select_for_update().get(id=contract_id)

        # Aggregate over non-void invoices
        agg = (
            Invoice.objects.filter(contract_id=contract_id)
            .exclude(status=Invoice.STATUS_VOID)
            .aggregate(
                truck_count=Count('id'),
                total_kg=Sum('quantity_kg'),
                total_usd=Sum('total_usd'),
            )
        )

        exported_trucks = agg['truck_count'] or 0
        exported_quantity_kg = agg['total_kg'] or Decimal('0')
        exported_amount_usd = agg['total_usd'] or Decimal('0')

        # Slice C will add payment aggregation. For now, payment_received_usd
        # stays unchanged — read the current value from the locked row.
        payment_received_usd = contract.payment_received_usd or Decimal('0')

        # Ostatok = exported amount - payments received
        remaining_usd = exported_amount_usd - payment_received_usd

        # Track the highest invoice number for convenience (NULL when no invoices)
        last_invoice_number = (
            Invoice.objects.filter(contract_id=contract_id)
            .aggregate(max_num=Max('invoice_number'))
            ['max_num']
        )

        # Use .update() to bypass Contract.save() — this is intentional.
        # Contract.save() has a placeholder remaining_usd formula that would
        # overwrite our correctly-computed value with stale data.
        Contract.objects.filter(pk=contract_id).update(
            exported_trucks=exported_trucks,
            exported_quantity_kg=exported_quantity_kg,
            exported_amount_usd=exported_amount_usd,
            remaining_usd=remaining_usd,
            last_invoice_number=last_invoice_number,
        )
