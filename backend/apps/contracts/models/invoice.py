"""Invoice model — one truck dispatch against a contract (2-Sales row)."""
from decimal import Decimal

from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class Invoice(models.Model):
    """One invoice represents one truck dispatched under a parent contract.

    Denormalized contract totals are updated automatically via
    ``rollup_contract_totals()`` called from save() and delete().
    That function is the single writer of Contract's exported_* fields.

    Status flow: draft → sent → paid → void.
    Only 'void' is excluded from rollup aggregates; all other statuses count.

    NOTE: A proper status-transition endpoint with audit trail is deferred to
    Slice F. Until then, PATCH ``status`` directly is permitted.
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
        related_name='invoices',
    )

    # === Shipment link (nullable — wired later) ===
    shipment = models.ForeignKey(
        'export.Shipment',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='invoices',
    )

    # === Invoice identifiers ===
    invoice_number = models.IntegerField()
    invoice_date = models.DateField()
    serial_truck_number = models.IntegerField(null=True, blank=True)

    # === Denormalized firm references (for reporting, optional) ===
    export_firm = models.ForeignKey(
        'core.ExportFirm',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='invoices',
    )
    import_firm = models.ForeignKey(
        'core.ImportFirm',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='invoices',
    )

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
        db_table = schema_table('contracts', 'invoice')
        unique_together = [('contract', 'invoice_number')]
        ordering = ['contract_id', 'invoice_number']

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
        so the new/updated invoice is visible to the aggregate query.

        If the invoice is being moved from one contract to another (rare),
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

        # If the invoice was reassigned to a different contract, roll up the old one too
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
