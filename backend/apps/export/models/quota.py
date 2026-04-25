"""Quota issuance models — government-issued export quotas.

A QuotaIssuance represents one government event where quota is distributed
across multiple export firms. Each firm's allocation is stored as a
QuotaIssuanceFirmAllocation row.

The issuance is auto-matched to an ISO sales week for analytics.
"""
from decimal import Decimal

from django.db import models
from django.db.models import Sum
from django.db.models.functions import Coalesce

from apps.core.db_utils import cyrillic_collation, schema_table


PRODUCT_TYPE_CHOICES = [
    ('tomato', 'Tomato'),
    ('pepper', 'Pepper'),
]


class QuotaIssuance(models.Model):
    """One government quota issuance event on a specific date.

    DDL: export.quota_issuances
    """

    issue_date = models.DateField()
    product_type = models.CharField(
        max_length=20, choices=PRODUCT_TYPE_CHOICES, default='tomato',
    )

    # Auto-matched to ISO week of issue_date (editable for manual reassignment)
    matched_week = models.PositiveSmallIntegerField(
        help_text='ISO week number this issuance is matched to',
    )
    matched_year = models.PositiveSmallIntegerField(
        help_text='ISO year for matched_week',
    )
    is_manually_reassigned = models.BooleanField(default=False)

    # Validity period: which month(s) this quota covers
    VALIDITY_CHOICES = [
        ('this_month', 'This month only'),
        ('this_and_next', 'This month + next month'),
        ('next_month', 'Next month only'),
    ]
    validity = models.CharField(
        max_length=20, choices=VALIDITY_CHOICES, default='this_month',
    )

    notes = models.CharField(max_length=500, blank=True, default='', **cyrillic_collation())
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    created_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='created_by', related_name='quota_issuances_created',
    )

    class Meta:
        db_table = schema_table('export', 'quota_issuances')
        ordering = ['issue_date']

    def save(self, *args, **kwargs):
        # Auto-compute matched week from issue_date if not manually reassigned.
        # NOTE: changing issue_date when is_manually_reassigned=False silently updates matched_week.
        if not self.is_manually_reassigned and self.issue_date:
            self.matched_week = self.issue_date.isocalendar()[1]
            self.matched_year = self.issue_date.isocalendar()[0]
        super().save(*args, **kwargs)

    @property
    def total_kg(self) -> Decimal:
        return self.allocations.aggregate(
            total=Coalesce(Sum('kg_quota'), Decimal('0'))
        )['total']

    def __str__(self) -> str:
        return f'{self.issue_date} — {self.product_type} ({self.total_kg} kg)'


class QuotaIssuanceFirmAllocation(models.Model):
    """Per-firm allocation within a single quota issuance event.

    DDL: export.quota_issuance_firm_allocations
    UNIQUE (issuance, export_firm)
    """

    issuance = models.ForeignKey(
        QuotaIssuance, on_delete=models.CASCADE,
        related_name='allocations',
    )
    export_firm = models.ForeignKey(
        'core.ExportFirm', on_delete=models.PROTECT,
        db_column='export_firm_id', related_name='quota_firm_allocations',
    )
    kg_quota = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        db_table = schema_table('export', 'quota_issuance_firm_allocations')
        constraints = [
            models.UniqueConstraint(
                fields=['issuance', 'export_firm'],
                name='uq_issuance_firm',
            ),
            models.CheckConstraint(
                check=models.Q(kg_quota__gt=0),
                name='chk_issuance_alloc_gt0',
            ),
        ]
        ordering = ['export_firm__code']

    def __str__(self) -> str:
        firm_name = getattr(self.export_firm, 'name_en', None) or f'firm#{self.export_firm_id}'
        return f'{firm_name}: {self.kg_quota} kg'


USAGE_STATUS_CHOICES = [
    ('draft', 'Draft'),
    ('approved', 'Approved'),
]

# Default truck weights (kg) by number of firms sharing a truck.
# Used when auto-creating usage records from firm splits.
DEFAULT_TRUCK_WEIGHTS = {
    1: Decimal('18100'),
    2: Decimal('9000'),
}


def get_default_truck_weight(num_firms: int) -> Decimal:
    """Return the default kg per firm based on how many firms share the truck.

    Falls back to evenly splitting 18,100 kg for 3+ firms.
    """
    return DEFAULT_TRUCK_WEIGHTS.get(num_firms, Decimal('18100') / num_firms)


class QuotaUsageRecord(models.Model):
    """Quota usage (export consumption) per firm per shipment.

    DDL: export.quota_usage_records
    Each row = kg of quota consumed by a firm on a specific date via exports.
    Auto-created when firm splits are assigned to a shipment (status=draft).
    Document team or admin approves before it counts in FIFO consumption.
    """

    usage_date = models.DateField()
    export_firm = models.ForeignKey(
        'core.ExportFirm', on_delete=models.PROTECT,
        db_column='export_firm_id', related_name='quota_usage_records',
    )
    kg_used = models.DecimalField(max_digits=12, decimal_places=2)
    product_type = models.CharField(
        max_length=20, choices=PRODUCT_TYPE_CHOICES, default='tomato',
    )
    notes = models.CharField(max_length=500, blank=True, default='', **cyrillic_collation())

    # === Shipment link (null for imported historical records) ===
    shipment = models.ForeignKey(
        'export.Shipment', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='quota_usage_records',
    )

    # === Approval workflow ===
    status = models.CharField(
        max_length=20, choices=USAGE_STATUS_CHOICES, default='draft',
    )
    approved_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='quota_usages_approved',
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    # === Audit ===
    created_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='quota_usages_created',
    )
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    class Meta:
        db_table = schema_table('export', 'quota_usage_records')
        ordering = ['-usage_date', 'export_firm']
        constraints = [
            models.CheckConstraint(
                check=models.Q(kg_used__gt=0),
                name='chk_usage_kg_gt0',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.usage_date} — {self.export_firm_id}: {self.kg_used} kg ({self.status})'
