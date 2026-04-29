from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


class QualityDocument(models.Model):
    """Quality inspection document flags for a shipment.

    One record per shipment. All four boolean fields correspond to physical
    documents that must accompany the cargo.
    """

    shipment = models.OneToOneField(
        'export.Shipment', on_delete=models.CASCADE, related_name='quality'
    )
    azyk_maglumatnama = models.BooleanField(default=False)
    suriji_gozukdiriji = models.BooleanField(default=False)
    hil_sertifikaty = models.BooleanField(default=False)
    kalibrowka_analiz = models.BooleanField(default=False)

    class Meta:
        db_table = schema_table('export', 'quality_documents')

    def __str__(self) -> str:
        return f'QualityDoc for {self.shipment.cargo_code}'


class ShipmentComment(models.Model):
    """Per-shipment threaded comments with @mentions and task assignment.

    AD-2: replaces free-text notes (vehicle_status_note).
    field_key: cell anchor from SHEET_ROW_CONFIG.fieldKey; NULL = shipment-level.
    mentions: CSV of user IDs (@user mentions). Nullable for backward compat.
    role_mentions: CSV of role codes (@role mentions). Non-null, default=''.
    """

    shipment = models.ForeignKey(
        'export.Shipment', on_delete=models.CASCADE, related_name='comments'
    )
    user = models.ForeignKey('core.User', on_delete=models.PROTECT)
    content = models.CharField(max_length=2000, **cyrillic_collation())

    # Cell anchor — NULL means shipment-level comment (existing behavior preserved).
    field_key = models.CharField(max_length=64, null=True, blank=True)

    # Comma-separated user IDs for @user mentions (existing pattern, nullable for compat).
    mentions = models.CharField(max_length=500, blank=True, null=True)
    # Comma-separated role codes for @role mentions — non-null unlike mentions.
    role_mentions = models.CharField(max_length=500, blank=True, default='')

    parent_comment = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name='replies'
    )
    is_system = models.BooleanField(default=False)

    # === Task fields (assignee is set = this is a task) ===
    assignee = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_comments',
    )
    is_done = models.BooleanField(default=False)
    done_at = models.DateTimeField(null=True, blank=True)
    done_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_comments',
    )

    # Soft-delete: threads stay coherent; replies still visible.
    is_deleted = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = schema_table('export', 'shipment_comments')
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['shipment', 'field_key'], name='ix_comments_shipment_field'),
            models.Index(fields=['assignee', 'is_done'], name='ix_comments_assignee_open'),
        ]

    def __str__(self) -> str:
        return f'Comment on {self.shipment.cargo_code} by {self.user.username}'

    @property
    def mentions_ids(self) -> list[int]:
        """Parse mentions CSV into list of user IDs. Handles NULL gracefully."""
        return [int(x) for x in (self.mentions or '').split(',') if x.strip()]

    @property
    def role_mentions_list(self) -> list[str]:
        """Parse role_mentions CSV into list of role code strings."""
        return [x for x in (self.role_mentions or '').split(',') if x.strip()]


class SalesReport(models.Model):
    """Final sales report filled when shipment reaches hasabat status.

    One record per shipment (OneToOne). Created by the sales rep at hasabat (step 12).
    Fields map to export.sales_reports in DDL v5.1 with column renames for clarity.
    """

    shipment = models.OneToOneField(
        'export.Shipment', on_delete=models.CASCADE, related_name='sales_report'
    )

    # === Pricing ===
    price_per_kg = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    total_usd = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        db_column='total_revenue_usd',
    )

    # === Actual weights (may differ from Shipment.weight_net) ===
    weight_sold_kg = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        db_column='sold_weight_kg',
    )
    weight_rejected_kg = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        db_column='waste_kg',
    )

    # === Expenses (USD) ===
    transport_cost_usd = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        db_column='transport_expenses',
    )
    market_fee_usd = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        db_column='storage_expenses',
    )
    other_expenses_usd = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        db_column='other_expenses',
    )

    # === Notes ===
    notes = models.TextField(null=True, blank=True, **cyrillic_collation())

    # === Audit ===
    created_by = models.ForeignKey(
        'core.User', on_delete=models.PROTECT, related_name='sales_reports_created'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = schema_table('export', 'sales_reports')

    def __str__(self) -> str:
        return f'SalesReport for {self.shipment.cargo_code}'
