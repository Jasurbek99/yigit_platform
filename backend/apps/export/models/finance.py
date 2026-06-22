# TODO: move to apps.finance once P5 finance app is created — these models
# belong in the finance domain but P5 doesn't exist yet. Keeping in export/
# temporarily to avoid creating an empty app. See SPRINT_PLAN.md Sprint 4+.
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class FinansistAdvance(models.Model):
    """A batch advance issued by the finansist (Babageldi) to cover customs costs.

    One advance may cover multiple shipments. Reconciliation marks the advance
    as settled once all covered shipments are accounted for in the final sales report.
    """

    # === Identifiers ===
    batch_code = models.CharField(max_length=50, blank=True, null=True)
    advance_date = models.DateField()

    # === Financial ===
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=10, default='USD')

    # === Metadata ===
    purpose = models.CharField(
        max_length=200, blank=True, null=True, **cyrillic_collation()
    )
    issued_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='advances_issued',
    )
    notes = models.CharField(
        max_length=500, blank=True, null=True, **cyrillic_collation()
    )

    # === Reconciliation ===
    reconciled = models.BooleanField(default=False)
    reconciled_at = models.DateTimeField(null=True, blank=True)

    # === Timestamps ===
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'finansist_advances')
        ordering = ['-advance_date', '-id']

    def __str__(self) -> str:
        code = self.batch_code or f'ADV-{self.id}'
        return f'{code} ({self.advance_date}) {self.total_amount} {self.currency}'


class FinansistAdvanceShipment(models.Model):
    """Junction table: which shipments a batch advance covers.

    allocated_amount is the portion of the advance earmarked for this specific
    shipment. It may be NULL when the advance covers multiple shipments and the
    per-shipment split hasn't been determined yet.
    """

    advance = models.ForeignKey(
        FinansistAdvance,
        on_delete=models.CASCADE,
        related_name='shipment_links',
    )
    shipment = models.ForeignKey(
        'export.Shipment',
        on_delete=models.CASCADE,
        related_name='advance_links',
    )
    allocated_amount = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )

    class Meta:
        db_table = schema_table('export', 'finansist_advance_shipments')
        unique_together = [('advance', 'shipment')]

    def __str__(self) -> str:
        return f'Advance {self.advance_id} → Shipment {self.shipment_id}'


class CustomsExpenseCategory(models.TextChoices):
    """Category codes for a single customs/document cash-advance expenditure."""

    GUMRUKLEME = 'GUMRUKLEME', 'Customs clearance (per truck)'
    KARANTIN = 'KARANTIN', 'Quarantine fee'
    CT1 = 'CT1', 'CT-1 certificate of origin'
    FITO = 'FITO', 'Phytosanitary certificate'
    ANALIZ = 'ANALIZ', 'Lab analysis'
    PASPORT_SDELKA = 'PASPORT_SDELKA', 'Deal passport (bank)'
    PLATYOSKA = 'PLATYOSKA', 'Payment order registration'
    DOC_POST = 'DOC_POST', 'Document postage'
    YUZLENME_HAT = 'YUZLENME_HAT', 'Reference letter'
    GUMRUK_AMAL = 'GUMRUK_AMAL', 'Customs operation fee'
    BORDER_RETURN = 'BORDER_RETURN', 'Truck returned (border closed)'
    SERTNAMA = 'SERTNAMA', 'Contract fee'
    OTHER = 'OTHER', 'Other'


CUSTOMS_EXPENSE_CATEGORIES = CustomsExpenseCategory.choices


class CustomsExpense(models.Model):
    """A single line of the customs/document cash-advance ledger (money-OUT side).

    Context: the cashier (e.g. Hangeldi) receives periodic float top-ups
    (FinansistAdvance, the money-IN side) and spends cash on per-truck or
    batch customs/document fees.  This model records each expenditure.

    Per-shipment fees (gumrukleme, fito, analiz, …) link to a Shipment via FK.
    Batch fees covering a group of shipments (e.g. "19 AD KARANTIN") set
    shipment=NULL and use the ``quantity`` field to store the unit count.

    Currency is TMT (Turkmen manat) by default — unlike FinansistAdvance which
    uses USD for advance float-ups.  A non-TMT row is valid but rare.

    The ledger balance at any point = sum(FinansistAdvance.total_amount) in TMT
    minus sum(CustomsExpense.amount).  See views_finance.py CustomsExpenseViewSet
    for the /ledger/ summary action.
    """

    # === Date & category ===
    expense_date = models.DateField()
    category = models.CharField(
        max_length=32,
        choices=CustomsExpenseCategory.choices,
    )

    # === Money ===
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=10, default='TMT')

    # === Shipment link (null for batch fees) ===
    shipment = models.ForeignKey(
        'export.Shipment',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='customs_expenses',
    )

    # === Raw source fields (verbatim from the Excel ledger) ===
    # Shipment codes are Latin-only — no Cyrillic collation (matching Shipment.shipment_code
    # avoids an MSSQL collation-conflict error if these are ever joined on import).
    # db_column kept as the original 'cargo_code_raw' so the rename is state-only (no SQL).
    shipment_code_raw = models.CharField(
        max_length=50, null=True, blank=True, db_column='cargo_code_raw'
    )
    vehicle_plate = models.CharField(max_length=60, null=True, blank=True)
    route_label = models.CharField(
        max_length=120, null=True, blank=True, **cyrillic_collation()
    )
    label_raw = models.CharField(
        max_length=255, null=True, blank=True, **cyrillic_collation()
    )

    # === Batch fee metadata ===
    quantity = models.PositiveSmallIntegerField(
        null=True, blank=True,
        help_text='Unit count for batch fees, e.g. 19 for "19 AD KARANTIN".',
    )

    # === Notes ===
    notes = models.CharField(
        max_length=500, null=True, blank=True, **cyrillic_collation()
    )

    # === Audit ===
    created_by = models.ForeignKey(
        'core.User',
        on_delete=models.PROTECT,
        related_name='customs_expenses_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'customs_expenses')
        ordering = ['-expense_date', '-id']
        indexes = [
            models.Index(fields=['shipment'], name='customs_exp_shipment_idx'),
            models.Index(fields=['category'], name='customs_exp_category_idx'),
            models.Index(fields=['expense_date'], name='customs_exp_date_idx'),
        ]

    def __str__(self) -> str:
        shipment_ref = self.shipment_code_raw or (f'Shipment {self.shipment_id}' if self.shipment_id else 'batch')
        return f'{self.expense_date} {self.category} {self.amount} {self.currency} [{shipment_ref}]'
