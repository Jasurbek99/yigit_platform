"""Sales report child models: line items and itemized expenses.

Lives alongside SalesReport (quality.py). These two child tables hang off
SalesReport via CASCADE FKs and are managed together through the nested
SalesReportSerializer.

Move from quality.py: SalesReport header fields were extended in quality.py.
New models here reference it by string to avoid import order issues.
"""

from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


# ---------------------------------------------------------------------------
# Expense category constants
# ---------------------------------------------------------------------------

class ExpenseCategory(models.TextChoices):
    """Controlled vocabulary for itemized expense categories on a sales report.

    Codes match the Excel template headings (transliterated).  Frontend handles
    display labels via i18n; the code is the stable key.
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


# Alias for external import without importing the class itself.
EXPENSE_CATEGORIES = ExpenseCategory.choices


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
    category = models.CharField(
        max_length=32, choices=ExpenseCategory.choices
    )
    # Exact sheet label — allows city-specific variants to be preserved.
    label_raw = models.CharField(
        max_length=120, null=True, blank=True, **cyrillic_collation()
    )
    amount_local = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = schema_table('export', 'sales_report_expenses')
        ordering = ['id']

    def __str__(self) -> str:
        return f'{self.category}: {self.amount_local}'
