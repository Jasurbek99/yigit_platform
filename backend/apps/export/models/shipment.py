import threading

from django.db import models
from apps.core.db_utils import cyrillic_collation, schema_table


# Thread-local re-entry guard for Shipment.save() → auto_advance_if_ready.
# transition_to() inside auto_advance_if_ready() calls shipment.save() again,
# which would re-enter the save handler and could loop. The flag short-circuits
# the second invocation so auto-advance only ever fires once per outer save.
# Thread-local (not module-level) keeps concurrent requests from blocking each
# other.
_AUTO_ADVANCE_REENTRY = threading.local()


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
    # Official 6-field export code physically tagged on pallets (format: DD|MM|NNN|BLK|YY|VV).
    # Separate from the auto-generated platform cargo_code; survives re-routings.
    official_export_code = models.CharField(max_length=30, blank=True, null=True, db_index=True)
    # When a shipment is re-routed, link back to the original platform shipment.
    previous_platform_id = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='reroutes',
    )
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
    # Primary (dominant) variety — kept for back-compat with existing queries.
    variety = models.ForeignKey(
        'core.TomatoVariety', on_delete=models.SET_NULL, null=True, blank=True
    )
    # Confidence level for variety assignment; unknown until post-packaging confirmation.
    VARIETY_CONFIDENCE_CHOICES = [
        ('high', 'From pallet data'),
        ('low', 'Manually estimated'),
        ('none', 'Pending packaging'),
    ]
    variety_confidence = models.CharField(
        max_length=10,
        choices=VARIETY_CONFIDENCE_CHOICES,
        default='none',
    )
    # All dominant varieties in a multi-variety truck (M2M, MSSQL-safe).
    varieties_dominant = models.ManyToManyField(
        'core.TomatoVariety',
        related_name='shipments_dominant_in',
        blank=True,
        db_table=schema_table('export', 'shipments_varieties_dominant'),
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
    # R15 — dispatcher's live status / ETA note (Haltaç). Free-form text.
    # Operator-entered on the Sheet; not tied to any status transition.
    vehicle_live_status = models.CharField(
        max_length=200, blank=True, null=True, **cyrillic_collation()
    )
    # R23 — human-readable truck/trailer plate (transport). Plain string;
    # trip_mgmt FKs (truck_head_id/trailer_id) stay separate for the future
    # managed-app rollout.
    truck_plate = models.CharField(max_length=50, blank=True, null=True)
    # R27 — driver name (transport). Operator-entered.
    driver_name = models.CharField(max_length=100, blank=True, null=True, **cyrillic_collation())
    # R28 — driver phone (transport). Operator-entered; free-form to allow
    # international formats and intl operator notation.
    driver_phone = models.CharField(max_length=30, blank=True, null=True)
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

    # === Operational status fields (sheet rows 6, 14) ===
    documents_status = models.CharField(
        max_length=20, blank=True, null=True,
        help_text='Row 6: ok, missing, in_progress',
    )
    harvest_status = models.CharField(
        max_length=20, blank=True, null=True,
        help_text='Row 14: ok, harvesting, not_ready',
    )
    customs_clearance_planned_day = models.CharField(
        max_length=12,
        blank=True,
        default='',
        choices=[
            ('mon', 'Mon'),
            ('tue', 'Tue'),
            ('wed', 'Wed'),
            ('thu', 'Thu'),
            ('fri', 'Fri'),
            ('sat', 'Sat'),
            ('sun', 'Sun'),
        ],
        help_text="Sirin's planned weekday for customs clearance prep",
    )
    # R4 — Şirin logs the time the transport department handed over the docs.
    # NULL = "Berilmedi" (not given); non-null = "Berildi" at this timestamp.
    transport_docs_given_at = models.DateTimeField(null=True, blank=True)

    # === Finance ===
    price_per_kg = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    total_amount_usd = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # === Lifecycle timestamps (formerly AD-1) ===
    # AD-1 is retired. Every lifecycle timestamp below is operator-entered on
    # the Sheet (R19/R21/R25/R30/R32/R35/R41/R42, input_type='datetime').
    # transition_to() still updates `status` + `status_changed_at`, but no
    # longer stamps any of these columns. Operators fill the actual physical
    # event time (gate stamp, door closed, sale concluded) which doesn't
    # necessarily line up with the status-transition click.
    loading_started_at = models.DateTimeField(null=True, blank=True)
    customs_entry_at = models.DateTimeField(null=True, blank=True)
    customs_exit_at = models.DateTimeField(null=True, blank=True)
    departed_at = models.DateTimeField(null=True, blank=True)
    border_crossed_at = models.DateTimeField(null=True, blank=True)
    # R31 — operator-entered datetime when truck entered destination country
    # (between border_crossed_at and customs_entry_at). NOT AD-1: no transition
    # writes this; sales_rep (Arap) logs it from the Sheet.
    dest_entry_at = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)
    sale_started_at = models.DateTimeField(null=True, blank=True)
    sale_ended_at = models.DateTimeField(null=True, blank=True)
    # Set by transition_to() on every status change. Used by KPIs and the
    # Shipment Board's time-in-phase calculation. Backfilled from
    # ShipmentStatusLog by migration 0011.
    status_changed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    # Operator-entered timestamp for when the warehouse finished loading the
    # truck (Sheet R20). NOT AD-1 — no transition writes this; warehouse staff
    # picks the date themselves on the Sheet.
    loading_ended_at = models.DateTimeField(null=True, blank=True)

    # Operator-entered date the sales report was filed (Sheet R43, owned by
    # Aganazar/sales_rep). Distinct from has_sales_report — that derived
    # boolean ("does a SalesReport row exist?") stays for downstream filters,
    # the Sheet now shows this picker instead.
    sales_report_date = models.DateField(null=True, blank=True)

    # Operator-entered harvest day (Sheet R39, owned by Soltanmyrat/
    # warehouse_chief). Free text — operators enter whatever form the operation
    # uses (single day, ranges like "5-10 oktýabr", notes), so this is a plain
    # CharField, not a DateField. The legacy per-block ShipmentBlockSource.
    # harvest_date column is now vestigial (the multi-block date editor was
    # removed); the Sheet reads and writes this single shipment-level field.
    harvest_date = models.CharField(
        max_length=100, null=True, blank=True, db_collation='Cyrillic_General_CI_AS'
    )

    # === AD-2: Structured vehicle fields (replaces deprecated vehicle_status_note) ===
    vehicle_condition = models.CharField(
        max_length=20, choices=VEHICLE_CONDITION_CHOICES, null=True, blank=True
    )
    vehicle_condition_note = models.CharField(max_length=300, blank=True, null=True, **cyrillic_collation())
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
    # Export manager's freeform note on this shipment (owned by Gadam).
    export_manager_note = models.TextField(blank=True, default='', **cyrillic_collation())
    # Warehouse / loading dept freeform note (owned by Soltanmyrat — loading_dept_head + warehouse_chief).
    warehouse_note = models.TextField(blank=True, default='', **cyrillic_collation())
    # Document team freeform note (owned by Şirin — document_team).
    document_note = models.TextField(blank=True, default='', **cyrillic_collation())
    # R44 — Arap's freeform note on the destination side (sales_rep).
    additional_notes_arap = models.TextField(blank=True, default='', **cyrillic_collation())

    # === Per-shipment column color (Sheet flag) ===
    # Operator-picked hex (`#RRGGBB`) used to tint this shipment's column in the
    # Sheet view so important / unusual trucks are visually flagged. NULL = no
    # custom color (default theme). Only admin + export_manager can edit (granted
    # via the wildcard 'shipment' field permission they already have).
    column_color = models.CharField(max_length=7, null=True, blank=True)

    # === Global Sheet column order (admin / export_manager only) ===
    # Sparse integer (step 1024) set by POST /sheet-order/. NULL = not manually
    # placed — falls back to date-descending order in the Sheet view so brand-new
    # shipments automatically appear at the correct position without requiring an
    # explicit re-order after every new creation. Only admin + export_manager can
    # write this field via the sheet-order endpoint; bulk_update() bypasses
    # Shipment.save() intentionally (no lifecycle hooks needed for a reorder).
    sheet_position = models.PositiveIntegerField(null=True, blank=True, db_index=True)

    # === Archive split (Phase 3, ADR-0005) ===
    # `is_archived` is flipped to True by the daily archive_shipments cron when
    # the row is in a terminal status AND has not been touched in 21 days.
    # Operational views default to is_archived=False; the Archive view explicitly
    # opts in via ?archived=true. Open (non-terminal) shipments stay in
    # operational forever — those are flagged separately by the stuck dashboard
    # (Phase 4), not auto-archived.
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    # === Soft delete (admin-only "trash" flag) ===
    # Distinct from `cancelled` status (which is a business decision with a reason
    # and pollutes the lifecycle log) and from `is_archived` (automatic after
    # 21 days terminal). Soft-deleted rows are hidden from every list/sheet/board
    # queryset by default; admins can list them via ?show_deleted=true on the
    # Shipments page and restore via POST /shipments/{id}/restore/. Hard-delete
    # (bulk-delete) remains the permanent escape hatch.
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='soft_deleted_shipments',
    )

    class Meta:
        db_table = schema_table('export', 'shipments')
        ordering = ['-date', '-id']

    def __str__(self) -> str:
        return self.cargo_code

    def save(self, *args, **kwargs):
        """Save, trigger task auto-resolution, then attempt status auto-advance.

        After every Model.save() call:
          1. The task engine re-checks all open/in-progress tasks on this
             shipment and marks DONE those whose target fields are now filled.
          2. If any tasks resolved, auto_advance_if_ready() walks the shipment
             forward through every step whose trigger is already satisfied —
             typically just one step (a save usually fills one trigger), but
             cascades through multiple when several triggers are pre-filled
             (e.g. a TaskRule edit + reconcile, a backfill, or a long-stuck
             draft whose downstream operator timestamps were filled before
             the rule fix landed). The thread-local re-entry guard prevents
             transition_to()'s inner save() from re-entering auto_advance —
             the cascade happens at the auto_advance level, not via save
             recursion.

        Lazy imports of services avoid circular references at module-load time
        (models/ → services/ → models/).

        Known limit: bulk operations (QuerySet.update(), bulk_update()) bypass
        this method. That is acceptable because all current shipment-write
        paths — Sheet PATCH, Detail PATCH, transition_to(), admin — go through
        serializer.save() → model.save(). If a future bulk-write path needs
        auto-resolution, call resolve_for_shipment() explicitly at the call
        site.
        """
        super().save(*args, **kwargs)

        from apps.export.services.task_rules import resolve_for_shipment
        resolved = resolve_for_shipment(self)

        # Re-entry guard: transition_to() calls shipment.save(update_fields=...)
        # which re-enters this method. Skip the second auto-advance attempt.
        if getattr(_AUTO_ADVANCE_REENTRY, 'active', False):
            return

        try:
            _AUTO_ADVANCE_REENTRY.active = True
            from apps.export.services.shipment import auto_advance_if_ready
            auto_advance_if_ready(self, resolved_tasks=resolved)
        finally:
            _AUTO_ADVANCE_REENTRY.active = False


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
    # True when the transition was fired by auto-advance (Shipment.save() →
    # auto_advance_if_ready) rather than an explicit user click. Different
    # from is_manual_override: that flag means a privileged user bypassed
    # the role gate; is_auto means no user explicitly clicked anything.
    is_auto = models.BooleanField(default=False)

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
    # Operator-entered date the tomatoes from THIS block were harvested.
    # Multi-block trucks can have different per-block harvest days, so this is
    # the primary source for Sheet R39; Shipment.harvest_date is the fallback
    # when no per-block dates are set or only one block is present.
    harvest_date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = schema_table('export', 'shipment_block_sources')
        unique_together = [('shipment', 'block')]

    def __str__(self) -> str:
        return f'{self.shipment.cargo_code} / block {self.block.code}'
