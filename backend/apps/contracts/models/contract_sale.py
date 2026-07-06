"""ContractSale model — one export firm's share of a truck (one "2-Sales" row).

IMPORTANT: a 2-Sales row is NOT a whole truck. One physical truck is commonly
split across 2 (~35%) — rarely 3 — export firms to keep each invoice under the
$10,000 threshold; each firm's share is a separate row with its own invoice,
CMR and contract. So 1 truck → 1..3 ContractSale rows. The truck itself lives in
``export.Shipment``; this row is bridged to it by ``(shipment, export_firm)`` —
the same identity as ``export.ShipmentFirmSplit``. See ADR-023.

Renamed from ``Invoice`` to avoid confusion with the actual *invoice document*
the platform generates (``invoice_ru`` / ``invoice_en`` templates). This model is
the sale *record*; the invoice is one of several documents produced from it. The
fields ``invoice_number`` / ``invoice_date`` are kept — they name the invoice
document's number/date for this sale.
"""
from decimal import Decimal

from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class ContractSale(models.Model):
    """One ContractSale = one export firm's share of a truck (one 2-Sales row),
    NOT a whole truck. A truck split across 2-3 firms produces 2-3 rows. Bridged
    to the export side by ``(shipment, export_firm)``. See ADR-023.

    Denormalized contract totals are updated automatically via
    ``rollup_contract_totals()`` called from save() and delete().
    That function is the single writer of Contract's exported_* fields.

    Status flow: draft → sent → paid → void.
    Only 'void' is excluded from rollup aggregates; all other statuses count.

    NOTE: A proper status-transition endpoint with audit trail is deferred.
    Until then, PATCH ``status`` directly is permitted.
    """

    STATUS_DRAFT = 'draft'
    STATUS_SENT = 'sent'
    STATUS_PAID = 'paid'
    STATUS_VOID = 'void'

    STATUS_CHOICES = [
        (STATUS_DRAFT, 'Draft'),
        (STATUS_SENT, 'Sent'),
        (STATUS_PAID, 'Paid'),
        (STATUS_VOID, 'Void'),
    ]

    # === Contract relationship ===
    contract = models.ForeignKey(
        'contracts.Contract',
        on_delete=models.PROTECT,
        related_name='sales',
    )

    # === Shipment link (nullable — bridge to export.Shipment) ===
    # Bridges to export.ShipmentFirmSplit by (shipment, export_firm). NOT yet
    # populated by the 2-Sales importer — truck reconstruction is Slice 3.
    # See ADR-023.
    shipment = models.ForeignKey(
        'export.Shipment',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='sales',
    )

    # === Invoice-document identifiers (the invoice number/date for this sale) ===
    # Nullable: when a sale is created as the shipment↔contract bridge (Slice 4),
    # the invoice number/date are filled later by a person at document time.
    invoice_number = models.IntegerField(null=True, blank=True)
    invoice_date = models.DateField(null=True, blank=True)
    serial_truck_number = models.IntegerField(null=True, blank=True)

    # === Denormalized firm references (for reporting, optional) ===
    export_firm = models.ForeignKey(
        'core.ExportFirm',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='sales',
    )
    import_firm = models.ForeignKey(
        'core.ImportFirm',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='sales',
    )

    # === Per-firm packing OVERRIDE (feeds this firm's Invoice) ===
    # The firm's packing is DERIVED from the truck's PackingPreset split by this
    # firm's weight share (net = quantity_kg, always consistent with the truck).
    # These four are OPTIONAL manual overrides — null means "use the derived value".
    # NET is never overridden here (it is the firm's official weight = quantity_kg),
    # so the per-firm split can't be made to disagree with the truck total.
    gross_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    box_count = models.IntegerField(null=True, blank=True)
    pallet_count = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    pallet_weight_kg = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    # === Trade terms ===
    incoterm = models.CharField(max_length=10, blank=True, default='')

    # === Financials ===
    quantity_kg = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
    )
    price_per_kg = models.DecimalField(
        max_digits=8, decimal_places=4, null=True, blank=True,
    )
    total_usd = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
    )

    # === Document tracking ===
    passport_sdelka = models.CharField(
        max_length=100,
        blank=True,
        default='',
        **cyrillic_collation(),
    )
    scan_uploaded = models.BooleanField(default=False)

    # === Status ===
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_SENT,  # Default: sent (matches Excel reality — all 2-Sales rows count)
    )

    # === Audit ===
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = schema_table('contracts', 'contract_sale')
        ordering = ['contract_id', 'invoice_number']
        constraints = [
            # Invoice number unique within a contract — filtered so the many
            # bridge sales with a not-yet-filled NULL invoice_number coexist
            # (MSSQL otherwise allows only one NULL).
            models.UniqueConstraint(
                fields=['contract', 'invoice_number'],
                condition=models.Q(invoice_number__isnull=False),
                name='uq_sale_contract_invoice',
            ),
            # One sale per (shipment, export_firm) — the Slice-4 bridge identity.
            # Filtered to linked sales; historical 2-Sales rows have shipment NULL.
            models.UniqueConstraint(
                fields=['shipment', 'export_firm'],
                condition=models.Q(shipment__isnull=False),
                name='uq_sale_shipment_firm',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.contract_id}/{self.invoice_number}'

    @classmethod
    def from_db(cls, db, field_names, values):
        """Snapshot the contract_id at load time for reassignment detection in save()."""
        instance = super().from_db(db, field_names, values)
        instance._loaded_contract_id = instance.contract_id
        return instance

    def save(self, *args, **kwargs) -> None:
        """Auto-compute total_usd and trigger contract rollup.

        Auto-compute rule: if total_usd is null/0 AND both quantity_kg and
        price_per_kg are provided (not None), compute total_usd = qty × price.
        This is a defensive fallback; the frontend does it interactively too.

        Rollup note: rollup_contract_totals() is the primary writer of
        Contract's exported_* fields. This save() calls it AFTER super().save()
        so the new/updated sale is visible to the aggregate query.

        If the sale is being moved from one contract to another (rare),
        both old and new contracts are re-rolled so neither goes stale.
        """
        # Auto-compute total_usd when both components are present
        if (
            (self.total_usd is None or self.total_usd == Decimal('0'))
            and self.quantity_kg is not None
            and self.price_per_kg is not None
        ):
            self.total_usd = self.quantity_kg * self.price_per_kg

        old_contract_id = getattr(self, '_loaded_contract_id', None)

        super().save(*args, **kwargs)

        # Local import to avoid the services↔models circular import
        from apps.contracts.services.rollup import rollup_contract_totals

        rollup_contract_totals(self.contract_id)

        # If the sale was reassigned to a different contract, roll up the old one too
        if old_contract_id is not None and old_contract_id != self.contract_id:
            rollup_contract_totals(old_contract_id)

        # Update snapshot so subsequent save() calls on the same instance are correct
        self._loaded_contract_id = self.contract_id

    def delete(self, *args, **kwargs):
        """Trigger contract rollup after deletion so totals drop correctly."""
        contract_id = self.contract_id
        result = super().delete(*args, **kwargs)

        # Local import to avoid the services↔models circular import
        from apps.contracts.services.rollup import rollup_contract_totals

        rollup_contract_totals(contract_id)
        return result
