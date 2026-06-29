"""Admin-managed expense category template for sales report expenses.

Each row represents one expense type that appears as a pre-listed row in the
Sales Report form. Admin/director/export_manager can add/edit/deactivate rows.
``logo_code`` is a reserved field for future LOGO ERP account sync — no sync
logic is implemented yet.
"""

from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


class ExpenseCategory(models.Model):
    """One expense category in the sales-report template.

    The ``code`` is the stable key (matches the former TextChoices enum codes
    plus any future admin-added entries). Frontend uses ``name_en``/``name_ru``/
    ``name_tk`` for display instead of hardcoded i18n keys so new admin-added
    categories are immediately visible without a code release.
    """

    # === Identifier ===
    code = models.CharField(max_length=32, unique=True)

    # === Display names ===
    name_tk = models.CharField(max_length=200, **cyrillic_collation())
    name_ru = models.CharField(
        max_length=200, blank=True, null=True, **cyrillic_collation()
    )
    name_en = models.CharField(max_length=200, blank=True, null=True)

    # === LOGO ERP integration (future) ===
    # Reserved for the LOGO accounting system account/category reference.
    # No sync logic is implemented — stored only.
    logo_code = models.CharField(max_length=50, null=True, blank=True)

    # === Ordering & status ===
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('export', 'expense_categories')
        ordering = ['sort_order', 'code']
        verbose_name = 'Expense Category'
        verbose_name_plural = 'Expense Categories'

    def __str__(self) -> str:
        return f'{self.code} — {self.name_en or self.name_tk}'
