from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


VEHICLE_CONDITION_CHOICES = [
    ('OK', 'OK'),
    ('ISSUE', 'Issue'),
    ('BREAKDOWN', 'Breakdown'),
    ('RETURNED', 'Returned'),
]


class Shipment(models.Model):
    """Main shipment record — one row per truck load.

    Status transitions happen ONLY via transition_to() in services.py.
    AD-1 denormalized timestamp fields are written ONLY by transition_to().
    AD-2 vehicle_status_note is deprecated; use vehicle_condition + comments.
    """

    # === Identifiers ===
    cargo_code = models.CharField(max_length=20, unique=True, db_column='code')
    date = models.DateField()
    season = models.ForeignKey('core.Season', on_delete=models.PROTECT, related_name='shipments')

    # === Geography ===
    country = models.ForeignKey(
        'core.Country', on_delete=models.PROTECT, null=True, blank=True, related_name='shipments'
    )
    city = models.ForeignKey(
        'core.City', on_delete=models.SET_NULL, null=True, blank=True, related_name='shipments'
    )
    border_point = models.ForeignKey(
        'core.BorderPoint', on_delete=models.SET_NULL, null=True, blank=True
    )
    loading_location = models.ForeignKey(
        'core.LoadingLocation', on_delete=models.SET_NULL, null=True, blank=True
    )

    # === Customer ===
    customer = models.ForeignKey(
        'core.Customer', on_delete=models.PROTECT, null=True, blank=True, related_name='shipments'
    )
    import_firm = models.ForeignKey(
        'core.ImportFirm', on_delete=models.SET_NULL, null=True, blank=True
    )

    # === Product ===
    product_type = models.ForeignKey(
        'core.ProductType', on_delete=models.SET_NULL, null=True, blank=True
    )
    variety = models.ForeignKey(
        'core.TomatoVariety', on_delete=models.SET_NULL, null=True, blank=True
    )

    # === Weight / Packaging ===
    weight_gross = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, db_column='weight_gross_kg'
    )
    weight_net = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, db_column='weight_net_kg'
    )
    packaging_kg = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    pallet_count = models.IntegerField(null=True, blank=True)
    pallet_weight_kg = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    box_count = models.IntegerField(null=True, blank=True)
    rejected_weight_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    # === Transport ===
    # Raw integer FKs — trip_mgmt is not yet a managed Django app
    truck_head_id = models.BigIntegerField(null=True, blank=True)
    trailer_id = models.BigIntegerField(null=True, blank=True)
    driver_id = models.BigIntegerField(null=True, blank=True)
    trip_id = models.BigIntegerField(null=True, blank=True)
    vehicle_responsible = models.CharField(max_length=50, blank=True, null=True)
    transport_temp_c = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    transit_days = models.IntegerField(null=True, blank=True)
    shelf_life_days = models.IntegerField(null=True, blank=True)
    has_peregruz = models.BooleanField(default=False)
    peregruz_city = models.CharField(max_length=100, blank=True, null=True, **cyrillic_collation())
    peregruz_date = models.DateTimeField(null=True, blank=True)

    # === Status ===
    status = models.ForeignKey(
        'core.ShipmentStatusType', on_delete=models.PROTECT, related_name='shipments'
    )
    is_gapy_satys = models.BooleanField(default=False)

    # === Finance ===
    price_per_kg = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    total_amount_usd = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # === AD-1: Denormalized lifecycle timestamps ===
    # Written ONLY by transition_to() in services.py. Never update directly.
    loading_started_at = models.DateTimeField(null=True, blank=True)
    customs_entry_at = models.DateTimeField(null=True, blank=True)
    customs_exit_at = models.DateTimeField(null=True, blank=True)
    departed_at = models.DateTimeField(null=True, blank=True)
    border_crossed_at = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)
    sale_started_at = models.DateTimeField(null=True, blank=True)
    sale_ended_at = models.DateTimeField(null=True, blank=True)

    # === AD-2: Structured vehicle fields (replaces deprecated vehicle_status_note) ===
    vehicle_condition = models.CharField(
        max_length=20, choices=VEHICLE_CONDITION_CHOICES, null=True, blank=True
    )
    vehicle_condition_note = models.CharField(max_length=300, blank=True, null=True, **cyrillic_collation())
    route_note = models.CharField(max_length=300, blank=True, null=True, **cyrillic_collation())
    # DEPRECATED: kept for historical data migration only — use vehicle_condition + Comments
    vehicle_status_note = models.CharField(max_length=500, blank=True, null=True, **cyrillic_collation())

    # === Audit ===
    created_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_shipments',
    )
    updated_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_shipments',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    notes = models.TextField(blank=True, null=True, **cyrillic_collation())

    class Meta:
        db_table = schema_table('export', 'shipments')
        ordering = ['-date', '-id']

    def __str__(self) -> str:
        return self.cargo_code


class ShipmentStatusLog(models.Model):
    """Audit trail for every status transition.

    Every call to transition_to() appends one row here.
    """

    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name='status_log')
    status = models.ForeignKey('core.ShipmentStatusType', on_delete=models.PROTECT)
    changed_by = models.ForeignKey('core.User', on_delete=models.PROTECT)
    changed_at = models.DateTimeField(auto_now_add=True)
    comment = models.CharField(max_length=500, blank=True, null=True, **cyrillic_collation())
    is_manual_override = models.BooleanField(default=False)

    class Meta:
        db_table = schema_table('export', 'shipment_status_log')
        ordering = ['-changed_at']

    def __str__(self) -> str:
        return f'{self.shipment.cargo_code} → {self.status.code}'


class ShipmentFirmSplit(models.Model):
    """Maps 1-3 export firms to a single shipment with per-firm weight and amount."""

    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name='firm_splits')
    export_firm = models.ForeignKey('core.ExportFirm', on_delete=models.PROTECT)
    weight_kg = models.DecimalField(max_digits=10, decimal_places=2)
    amount_usd = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    invoice_number = models.CharField(max_length=20, blank=True, null=True)
    split_order = models.IntegerField(default=1)

    class Meta:
        db_table = schema_table('export', 'shipment_firm_splits')
        unique_together = [('shipment', 'export_firm')]
        ordering = ['split_order']

    def __str__(self) -> str:
        return f'{self.shipment.cargo_code} / {self.export_firm.code}'


class ShipmentBlockSource(models.Model):
    """Records which greenhouse blocks (1-3) contributed weight to a shipment."""

    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name='block_sources')
    block = models.ForeignKey('core.GreenhouseBlock', on_delete=models.PROTECT)
    weight_kg = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        db_table = schema_table('export', 'shipment_block_sources')
        unique_together = [('shipment', 'block')]

    def __str__(self) -> str:
        return f'{self.shipment.cargo_code} / block {self.block.code}'


class QualityDocument(models.Model):
    """Quality inspection document flags for a shipment.

    One record per shipment. All four boolean fields correspond to physical
    documents that must accompany the cargo.
    """

    shipment = models.OneToOneField(Shipment, on_delete=models.CASCADE, related_name='quality')
    azyk_maglumatnama = models.BooleanField(default=False)
    suriji_gozukdiriji = models.BooleanField(default=False)
    hil_sertifikaty = models.BooleanField(default=False)
    kalibrowka_analiz = models.BooleanField(default=False)

    class Meta:
        db_table = schema_table('export', 'quality_documents')

    def __str__(self) -> str:
        return f'QualityDoc for {self.shipment.cargo_code}'


class ShipmentComment(models.Model):
    """Per-shipment threaded comments with @mentions (AD-2: replaces free-text notes)."""

    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name='comments')
    user = models.ForeignKey('core.User', on_delete=models.PROTECT)
    content = models.CharField(max_length=2000, **cyrillic_collation())
    # Comma-separated user IDs for @mentions — avoids JSONField / ArrayField (MSSQL constraint)
    mentions = models.CharField(max_length=500, blank=True, null=True)
    parent_comment = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name='replies'
    )
    is_system = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = schema_table('export', 'shipment_comments')
        ordering = ['created_at']

    def __str__(self) -> str:
        return f'Comment on {self.shipment.cargo_code} by {self.user.username}'


class SalesReport(models.Model):
    """Final sales report filled when shipment reaches hasabat status.

    One record per shipment (OneToOne). Created by the sales rep at hasabat (step 12).
    Fields map to export.sales_reports in DDL v5.1 with column renames for clarity.
    """

    shipment = models.OneToOneField(
        Shipment, on_delete=models.CASCADE, related_name='sales_report'
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
