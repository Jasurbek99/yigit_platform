"""Contract model — the master agreement between one export firm and one import firm."""
from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class Contract(models.Model):
    """A signed sale agreement for one season between an export firm (seller) and import firm (buyer).

    Denormalized totals (exported_trucks, exported_quantity_kg, exported_amount_usd,
    payment_received_usd, remaining_usd) are written ONLY by the rollup service
    (``contracts.services.rollup.rollup_contract_totals``), never edited directly.
    Until Slice B introduces the rollup service, ``remaining_usd`` is kept consistent
    in ``save()`` as a placeholder calculation.

    Status flow: active → completed → closed → cancelled.
    """

    STATUS_ACTIVE = 'active'
    STATUS_COMPLETED = 'completed'
    STATUS_CLOSED = 'closed'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'Active'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_CLOSED, 'Closed'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    # === Identifiers ===
    contract_number = models.CharField(
        max_length=100,
        unique=True,
        **cyrillic_collation(),
    )

    # === Relationships ===
    season = models.ForeignKey(
        'core.Season',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='contracts',
    )
    export_firm = models.ForeignKey(
        'core.ExportFirm',
        on_delete=models.PROTECT,
        related_name='contracts',
    )
    import_firm = models.ForeignKey(
        'core.ImportFirm',
        on_delete=models.PROTECT,
        related_name='contracts',
    )
    customer = models.ForeignKey(
        'core.Customer',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='contracts',
    )

    # === Contract terms ===
    contract_type = models.CharField(max_length=20, default='EXPORT')
    incoterm = models.CharField(max_length=10, blank=True, default='')
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)

    # === Planned quantities ===
    planned_trucks = models.IntegerField(null=True, blank=True)
    planned_quantity_kg = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
    )
    planned_amount_usd = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
    )

    # === Denormalized execution totals (written by rollup service only) ===
    exported_trucks = models.IntegerField(default=0)
    exported_quantity_kg = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0'),
    )
    exported_amount_usd = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0'),
    )
    payment_received_usd = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0'),
    )
    # Ostatok: exported_amount_usd - payment_received_usd. Auto-set in save()
    # until the Slice B rollup service takes ownership.
    remaining_usd = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0'),
    )

    # === Invoice tracking ===
    last_invoice_number = models.IntegerField(null=True, blank=True)
    sent_to_unk = models.BooleanField(default=False)

    # === Status ===
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_ACTIVE,
    )

    # === Audit ===
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='created_contracts',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = schema_table('contracts', 'contract')
        ordering = ['created_at']

    def __str__(self) -> str:
        return self.contract_number

    def save(self, *args, **kwargs) -> None:
        """Recompute remaining_usd as a fallback when no invoices exist.

        Primary path: ``rollup_contract_totals()`` (``contracts.services.rollup``)
        recomputes all five denormalized fields from invoice/payment aggregates
        and writes them via ``.update()`` (bypassing this save). That path fires
        on every Invoice write/delete.

        This placeholder formula only runs when the Contract is saved directly
        (e.g. on create, or admin edits) without any invoice activity triggering
        the rollup. It keeps remaining_usd consistent in the absence of invoices.
        Never write exported_* or remaining_usd outside the rollup service.
        """
        self.remaining_usd = (self.exported_amount_usd or Decimal('0')) - (
            self.payment_received_usd or Decimal('0')
        )
        super().save(*args, **kwargs)

    # === Computed properties (not stored) ===

    @property
    def trucks_remaining(self) -> int:
        """Planned trucks minus exported trucks."""
        return (self.planned_trucks or 0) - (self.exported_trucks or 0)

    @property
    def quantity_remaining_kg(self) -> Decimal:
        """Planned quantity minus exported quantity in kg."""
        return (self.planned_quantity_kg or Decimal('0')) - (
            self.exported_quantity_kg or Decimal('0')
        )

    @property
    def amount_remaining_usd(self) -> Decimal:
        """Planned amount minus exported amount in USD."""
        return (self.planned_amount_usd or Decimal('0')) - (
            self.exported_amount_usd or Decimal('0')
        )

    @property
    def percent_consumed(self) -> int:
        """Percentage of planned trucks that have been exported. 0 if not planned."""
        if not self.planned_trucks:
            return 0
        return round(self.exported_trucks / self.planned_trucks * 100)

    @property
    def ostatok_usd(self) -> Decimal:
        """Alias for remaining_usd — Ostatok (balance outstanding)."""
        return self.remaining_usd
