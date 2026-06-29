"""Sales report child models: line items and itemized expenses.

Lives alongside SalesReport (quality.py). The child tables hang off
SalesReport via CASCADE FKs and are managed together through the nested
SalesReportSerializer.

Move from quality.py: SalesReport header fields were extended in quality.py.
New models here reference it by string to avoid import order issues.
"""

from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


# ---------------------------------------------------------------------------
# Expense category constants (seed source only — no longer used on the model)
# ---------------------------------------------------------------------------

class ExpenseCategoryEnum(models.TextChoices):
    """Controlled vocabulary for expense categories — kept as the canonical
    seed list for the ``ExpenseCategory`` DB table and for data migrations.

    The model field ``SalesReportExpense.category`` is now a FK to
    ``export.ExpenseCategory``, not a choices field.  This enum is preserved
    so data migrations and import scripts can reference code values without
    depending on live ORM models.
    """

    TOM_ROSHOD = 'TOM_ROSHOD', 'Tom Roshod (Production cost deduction)'
    NAKLIYE = 'NAKLIYE', 'Nakliye (Transport/delivery fee)'
    BAZAR_ROSHOD = 'BAZAR_ROSHOD', 'Bazar Roshod (Market fee)'
    INTERES = 'INTERES', 'Interes (Commission/interest)'
    UZBEK_FURA_AWANS = 'UZBEK_FURA_AWANS', 'Uzbek Fura Awans (Uzbek truck advance)'
    DOZWOL = 'DOZWOL', 'Dozwol (Permit fee)'
    ANALIZ = 'ANALIZ', 'Analiz (Lab analysis fee)'
    PROSTOY = 'PROSTOY', 'Prostoy (Demurrage)'
    PERESEPKA = 'PERESEPKA', 'Peresepka (Reloading fee)'
    ARAP = 'ARAP', 'Arap (Arab brokerage)'
    KASPIY_KOMIS = 'KASPIY_KOMIS', 'Kaspiy Komis (Caspian commission)'
    UZBEK_FURA_SOLYARKA = 'UZBEK_FURA_SOLYARKA', 'Uzbek Fura Solyarka (Uzbek truck fuel)'
    NDS = 'NDS', 'NDS (VAT)'
    SBOR = 'SBOR', 'Sbor (Levy/collection fee)'
    UZB_KAZ_POST = 'UZB_KAZ_POST', 'Uzb-Kaz Post (UZ-KZ postal/border fee)'
    UZB_KAZ_NAKLIYE = 'UZB_KAZ_NAKLIYE', 'Uzb-Kaz Nakliye (UZ-KZ transport)'
    UZBEK_TAM = 'UZBEK_TAM', 'Uzbek Tam (Uzbek customs)'
    MOI = 'MOI', 'Moi (Security/police fee)'
    DOSMOTR = 'DOSMOTR', 'Dosmotr (Inspection fee)'
    PEREWOT = 'PEREWOT', 'Perewot (Translation fee)'
    OTHER = 'OTHER', 'Other'


# Alias kept for backward compat — external callers can still import this name.
EXPENSE_CATEGORIES = ExpenseCategoryEnum.choices


# ---------------------------------------------------------------------------
# SalesReportLineItem
# ---------------------------------------------------------------------------

class SalesReportLineItem(models.Model):
    """One price-tier row in the sales report (qty kg × price → amount).

    A single shipment may have 1–14 line items (different price tiers for the
    same lot, or different product grades).  The serializer computes amount_local
    = quantity_kg × price_local and stores it here for fast aggregation.
    """

    # String ref to avoid cross-file import ordering issues.
    report = models.ForeignKey(
        'export.SalesReport',
        on_delete=models.CASCADE,
        related_name='line_items',
    )
    line_number = models.PositiveSmallIntegerField()
    product_name = models.CharField(
        max_length=200, null=True, blank=True, **cyrillic_collation()
    )
    quantity_kg = models.DecimalField(max_digits=10, decimal_places=2)
    price_local = models.DecimalField(max_digits=12, decimal_places=2)
    # Stored (qty * price) — recomputed on every save via serializer.
    amount_local = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = schema_table('export', 'sales_report_line_items')
        ordering = ['line_number']

    def __str__(self) -> str:
        return (
            f'LineItem #{self.line_number} '
            f'({self.quantity_kg} kg × {self.price_local})'
        )


# ---------------------------------------------------------------------------
# SalesReportExpense
# ---------------------------------------------------------------------------

class SalesReportExpense(models.Model):
    """One itemized expense row in the sales report.

    Uses a controlled ``category`` enum for reliable aggregation across
    shipments.  ``label_raw`` preserves the exact text from the source
    Excel sheet for audit/import fidelity (e.g. city-specific NAKLIYE labels).
    """

    report = models.ForeignKey(
        'export.SalesReport',
        on_delete=models.CASCADE,
        related_name='expenses',
    )
    # FK to the admin-managed expense category template.  Use string ref to
    # avoid import ordering issues (both models live in the export app).
    # PROTECT so that deleting a category in use raises an error rather than
    # silently removing expense rows (follow-up: consider a soft-delete guard
    # in the admin viewset before production data accumulates).
    category = models.ForeignKey(
        'export.ExpenseCategory',
        on_delete=models.PROTECT,
        related_name='expense_rows',
    )
    # Exact sheet label — allows city-specific NAKLIYE variants to be preserved.
    label_raw = models.CharField(
        max_length=120, null=True, blank=True, **cyrillic_collation()
    )
    amount_local = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = schema_table('export', 'sales_report_expenses')
        ordering = ['id']

    def __str__(self) -> str:
        category_code = self.category.code if self.category_id else '?'
        return f'{category_code}: {self.amount_local}'

