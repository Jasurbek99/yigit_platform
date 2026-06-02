import re
from decimal import Decimal

from rest_framework import serializers

from apps.core.models import City, Country, Customer, ExportFirm, ImportFirm, Season, GreenhouseBlock, TomatoVariety
from apps.core.permissions import can_edit_field, PRIVILEGED_ROLES
from apps.export.services import TRANSITIONS, _edge_to
from apps.export.services.phases import get_phase as resolve_phase, resolve_phase_entry
from apps.export.validators import validate_official_export_code  # noqa: F401  (kept for downstream importers)
from apps.export.models import (
    FinansistAdvance,
    FinansistAdvanceShipment,
    Pallet,
    QualityDocument,
    SalesReport,
    Shipment,
    ShipmentStatusLog,
    ShipmentFirmSplit,
    ShipmentBlockSource,
    ShipmentComment,
    Task,
    TaskCompletionRule,
    TaskState,
)


class TomatoVarietyInlineSerializer(serializers.ModelSerializer):
    """Minimal read-only variety representation used in varieties_dominant list."""

    class Meta:
        model = TomatoVariety
        fields = ['id', 'code', 'name', 'is_experimental']


class QualityDocumentSerializer(serializers.ModelSerializer):
    """Serializer for quality inspection document flags."""

    class Meta:
        model = QualityDocument
        fields = ['azyk_maglumatnama', 'suriji_gozukdiriji', 'hil_sertifikaty', 'kalibrowka_analiz']


class SalesReportSerializer(serializers.ModelSerializer):
    """Serializer for the final sales report submitted at hasabat (step 12)."""

    class Meta:
        model = SalesReport
        fields = [
            'price_per_kg',
            'total_usd',
            'weight_sold_kg',
            'weight_rejected_kg',
            'transport_cost_usd',
            'market_fee_usd',
            'other_expenses_usd',
            'notes',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class ShipmentListSerializer(serializers.ModelSerializer):
    """Lightweight list serializer — no nested objects.

    Used by the ProTable list view. Matches api-contract.md list shape.
    """

    # DB column is status_id (FK); expose both ID and display name per api-contract
    status_display = serializers.CharField(source='status.name_en', read_only=True)
    status_code = serializers.CharField(source='status.code', read_only=True)
    status_step = serializers.IntegerField(source='status.step_order', read_only=True)
    country_name = serializers.CharField(source='country.name_en', read_only=True)
    country_code = serializers.CharField(source='country.code', read_only=True, default=None)
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    city_name = serializers.CharField(source='city.name', read_only=True, default=None)
    variety_name = serializers.CharField(source='variety.name', read_only=True, default=None)
    variety_code = serializers.CharField(source='variety.code', read_only=True, default=None)
    border_point_name = serializers.CharField(source='border_point.name', read_only=True, default=None)

    # Import firm — name_short with name_company fallback (mirrors sheet serializer)
    import_firm_name = serializers.SerializerMethodField()

    def get_import_firm_name(self, obj) -> str | None:
        firm = obj.import_firm
        if not firm:
            return None
        return firm.name_short or firm.name_company

    # Transport — human label for the responsible-party enum
    vehicle_responsible_display = serializers.CharField(source='vehicle_responsible', read_only=True)

    # Audit
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, default=None)
    # Soft-delete metadata — only relevant on the admin ?show_deleted=true view,
    # but cheap to always include (FK is on the base queryset).
    deleted_by_name = serializers.CharField(source='deleted_by.username', read_only=True, default=None)

    # Quality document flags (flattened from OneToOne related_name 'quality').
    # default=False so a shipment with no QualityDocument row reports unchecked.
    doc_azyk = serializers.BooleanField(source='quality.azyk_maglumatnama', read_only=True, default=False)
    doc_suriji = serializers.BooleanField(source='quality.suriji_gozukdiriji', read_only=True, default=False)
    doc_hil = serializers.BooleanField(source='quality.hil_sertifikaty', read_only=True, default=False)
    doc_kalibrowka = serializers.BooleanField(source='quality.kalibrowka_analiz', read_only=True, default=False)

    # Phase grouping (Stream C) — maps status code to PLAN/PREP/DOCS/LOAD/TRANSIT/DEST/CLOSE.
    phase = serializers.SerializerMethodField()

    def get_phase(self, obj) -> str:
        """Return the canonical phase code for this shipment's current status."""
        code = obj.status.code if obj.status_id else None
        return resolve_phase(code)

    # Freshness fields (Finding #5b — expiration clock).
    # NOTE: The spec called for deriving age from the earliest ShipmentBlockSource.harvest_date,
    # but ShipmentBlockSource has no harvest_date column today (only weight_kg).
    # Falling back to Shipment.date is the correct simpler implementation until
    # harvest_date is added to the block source table.
    harvest_age_days = serializers.SerializerMethodField()
    freshness = serializers.SerializerMethodField()

    def get_harvest_age_days(self, obj) -> int:
        """Days since the shipment's date. Fallback to today if date is null.

        Age is clamped to 0 — a future-dated shipment (data entry error) is treated
        as 'today' rather than returning a negative age.
        """
        from django.utils import timezone as _tz
        base = obj.date or _tz.now().date()
        today = _tz.now().date()
        return max(0, (today - base).days)

    def get_freshness(self, obj) -> str:
        """Freshness label derived from harvest_age_days.

        Returns:
            'today'     — 0 days old (harvested today).
            'yesterday' — 1 day old (may still be export-grade).
            'aged'      — 2+ days old (domestic-only or waste risk).
        """
        age = self.get_harvest_age_days(obj)
        if age == 0:
            return 'today'
        if age == 1:
            return 'yesterday'
        return 'aged'

    class Meta:
        model = Shipment
        fields = [
            'id',
            'cargo_code',
            'official_export_code',
            'date',
            'status',
            'status_display',
            'status_code',
            'status_step',
            'country_name',
            'country_code',
            'customer_name',
            'weight_net',
            'weight_gross',
            'departed_at',
            'arrived_at',
            'is_gapy_satys',
            'updated_at',
            # Fields needed by Kanban "My Tasks" missing-field detection
            'city_name',
            'variety_name',
            'border_point_name',
            'harvest_status',
            'documents_status',
            'truck_head_id',
            'driver_id',
            'price_per_kg',
            'total_amount_usd',
            # Freshness clock (Finding #5b)
            'harvest_age_days',
            'freshness',
            # Phase grouping (Stream C)
            'phase',
            # ── Opt-in column fields (Sheet parity, scalar only) ──────────────
            # These extend the list payload so the ShipmentList column manager
            # can offer the same operational fields the Sheet shows as rows.
            # Nested firm_splits / block_sources are intentionally excluded —
            # the list endpoint stays flat (no related-table prefetch).
            # Customer / product
            'import_firm', 'import_firm_name',
            'variety', 'variety_code',
            # Weight detail
            'packaging_kg', 'pallet_count', 'box_count', 'rejected_weight_kg',
            # Transport
            'vehicle_responsible', 'vehicle_responsible_display',
            'trailer_id',
            'truck_plate', 'driver_name', 'driver_phone',
            'transport_temp_c', 'transit_days',
            'has_peregruz', 'peregruz_city', 'peregruz_date',
            # Operational planning
            'customs_clearance_planned_day',
            # R4 — Şirin logs when transport dept handed docs over
            'transport_docs_given_at',
            # AD-1 + operator-entered timestamps
            'loading_started_at', 'customs_entry_at', 'customs_exit_at',
            'border_crossed_at', 'sale_started_at', 'sale_ended_at',
            'dest_entry_at', 'loading_ended_at', 'sales_report_date',
            'harvest_date',
            # AD-2 vehicle condition + live status
            'vehicle_condition', 'vehicle_condition_note', 'vehicle_live_status',
            # Quality doc flags (flattened)
            'doc_azyk', 'doc_suriji', 'doc_hil', 'doc_kalibrowka',
            # Notes
            'notes', 'export_manager_note', 'warehouse_note',
            'document_note', 'additional_notes_arap',
            # Audit
            'created_by_name', 'created_at',
            # Soft-delete metadata (admin show_deleted view)
            'deleted_at', 'deleted_by_name',
        ]


class OverdueShipmentSerializer(ShipmentListSerializer):
    """Extends ShipmentListSerializer with overdue-specific annotation fields.

    Used by GET /api/v1/export/shipments/overdue/.
    Both fields are computed by the queryset annotation — not DB columns.
    """

    days_overdue = serializers.IntegerField(read_only=True)
    has_sales_report = serializers.BooleanField(read_only=True)

    class Meta(ShipmentListSerializer.Meta):
        fields = ShipmentListSerializer.Meta.fields + ['days_overdue', 'has_sales_report']


class DraftBlockSourceInlineSerializer(serializers.ModelSerializer):
    """Block source row shape consumed by the DraftPool DraftCard."""

    block_id = serializers.IntegerField(source='block.id', read_only=True)
    block_code = serializers.CharField(source='block.code', read_only=True)

    class Meta:
        model = ShipmentBlockSource
        fields = ['block_id', 'block_code', 'weight_kg', 'harvest_date']


class ShipmentDraftListSerializer(ShipmentListSerializer):
    """List shape for status_code=draft, matching the frontend IShipmentDraft.

    The standard ShipmentListSerializer omits block_sources and creator info to
    keep the operational list lightweight; the DraftPool page needs both, so we
    layer the draft-specific fields on top.
    """

    # created_by_name is now provided by the base ShipmentListSerializer; the
    # draft view adds only the block sources and draft-specific scalar fields.
    block_sources = DraftBlockSourceInlineSerializer(many=True, read_only=True)

    class Meta(ShipmentListSerializer.Meta):
        fields = ShipmentListSerializer.Meta.fields + [
            'block_sources',
            'previous_platform_id',
            'variety_confidence',
        ]


class SheetFirmSplitInlineSerializer(serializers.ModelSerializer):
    """Inline firm split for sheet view — minimal fields."""

    firm_code = serializers.CharField(source='export_firm.code', read_only=True)
    firm_name = serializers.CharField(source='export_firm.name_en', read_only=True)
    # Per-firm cell color — paints the firm-chip in the firm_splits cell.
    firm_color = serializers.CharField(source='export_firm.color', read_only=True, default=None)

    class Meta:
        model = ShipmentFirmSplit
        fields = ['firm_code', 'firm_name', 'firm_color', 'weight_kg', 'amount_usd']


class SheetBlockSourceInlineSerializer(serializers.ModelSerializer):
    """Inline block source for sheet view — minimal fields."""

    block_id = serializers.IntegerField(source='block.id', read_only=True)
    block_code = serializers.CharField(source='block.code', read_only=True)
    # Per-block cell color — paints the block-chip in the block_sources cell.
    block_color = serializers.CharField(source='block.color', read_only=True, default=None)

    class Meta:
        model = ShipmentBlockSource
        fields = ['block_id', 'block_code', 'block_color', 'weight_kg', 'harvest_date']


class ShipmentSheetSerializer(serializers.ModelSerializer):
    """Flat serializer returning all 44+ fields for the spreadsheet view.

    Used by GET /api/v1/export/shipments/sheet/ — returns ALL shipments
    for the active season without pagination.

    Notes:
      - quality_* fields use source='quality.*' — the OneToOne related_name
        on QualityDocument is 'quality', not 'quality_document'.
      - variety_code maps to TomatoVariety.type (the variety has no code field).
      - has_sales_report must be annotated by the viewset queryset before
        passing to this serializer.
    """

    # Status
    status_display = serializers.CharField(source='status.name_en', read_only=True)
    status_code = serializers.CharField(source='status.code', read_only=True)
    status_step = serializers.IntegerField(source='status.step_order', read_only=True)

    # Geography
    country_name = serializers.CharField(source='country.name_en', read_only=True, default=None)
    country_code = serializers.CharField(source='country.code', read_only=True, default=None)
    country_color = serializers.CharField(source='country.color', read_only=True, default=None)
    city_name = serializers.CharField(source='city.name', read_only=True, default=None)
    city_color = serializers.CharField(source='city.color', read_only=True, default=None)
    border_point_name = serializers.CharField(source='border_point.name', read_only=True, default=None)
    border_point_color = serializers.CharField(source='border_point.color', read_only=True, default=None)

    # Customer
    customer_name = serializers.CharField(source='customer.name', read_only=True, default=None)
    customer_color = serializers.CharField(source='customer.color', read_only=True, default=None)
    import_firm_name = serializers.SerializerMethodField()
    import_firm_color = serializers.CharField(source='import_firm.color', read_only=True, default=None)

    def get_import_firm_name(self, obj) -> str | None:
        firm = obj.import_firm
        if not firm:
            return None
        return firm.name_short or firm.name_company

    # Product — variety.code is the official registry code (01-10, E1-E3)
    variety_name = serializers.CharField(source='variety.name', read_only=True, default=None)
    variety_code = serializers.CharField(source='variety.code', read_only=True, default=None)
    variety_color = serializers.CharField(source='variety.color', read_only=True, default=None)
    variety_confidence = serializers.CharField(read_only=True)

    # Transport
    vehicle_responsible_display = serializers.CharField(source='vehicle_responsible', read_only=True)

    # Audit
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, default=None)
    # Role of the user who created this shipment — allows the frontend to tint
    # columns created by loading_dept_head / warehouse_chief differently from
    # export_manager drafts in the two-column join view.
    created_by_role = serializers.CharField(source='created_by.role', read_only=True, default=None)

    # Quality document flags (flattened) — related_name on QualityDocument is 'quality'
    doc_azyk = serializers.BooleanField(source='quality.azyk_maglumatnama', read_only=True, default=False)
    doc_suriji = serializers.BooleanField(source='quality.suriji_gozukdiriji', read_only=True, default=False)
    doc_hil = serializers.BooleanField(source='quality.hil_sertifikaty', read_only=True, default=False)
    doc_kalibrowka = serializers.BooleanField(source='quality.kalibrowka_analiz', read_only=True, default=False)

    # Annotated by viewset — Exists(SalesReport.objects.filter(shipment=OuterRef('pk')))
    has_sales_report = serializers.BooleanField(read_only=True)

    # Annotated by viewset — Exists(FinansistAdvanceShipment.objects.filter(shipment=OuterRef('pk')))
    # R24 — true once finansist (Babageldi) has issued documentation/customs advance for the shipment.
    has_doc_advance = serializers.BooleanField(read_only=True)

    # Phase grouping (Stream C) — maps status code to PLAN/PREP/DOCS/LOAD/TRANSIT/DEST/CLOSE.
    phase = serializers.SerializerMethodField()

    def get_phase(self, obj) -> str:
        """Return the canonical phase code for this shipment's current status."""
        code = obj.status.code if obj.status_id else None
        return resolve_phase(code)

    # Inline related data
    firm_splits = SheetFirmSplitInlineSerializer(many=True, read_only=True)
    block_sources = SheetBlockSourceInlineSerializer(many=True, read_only=True)
    # Multi-variety dominant list — N+1-safe when queryset prefetches 'varieties_dominant'
    varieties_dominant = TomatoVarietyInlineSerializer(many=True, read_only=True)

    class Meta:
        model = Shipment
        fields = [
            # Identifiers
            'id', 'cargo_code', 'official_export_code', 'date',
            # Status
            'status', 'status_display', 'status_code', 'status_step',
            # Phase grouping (Stream C)
            'phase',
            # Geography
            'country', 'country_name', 'country_code', 'country_color',
            'city', 'city_name', 'city_color',
            'border_point', 'border_point_name', 'border_point_color',
            # Customer
            'customer', 'customer_name', 'customer_color',
            'import_firm', 'import_firm_name', 'import_firm_color',
            # Product
            'variety', 'variety_name', 'variety_code', 'variety_color', 'variety_confidence',
            # Weight
            'weight_gross', 'weight_net', 'packaging_kg',
            'pallet_count', 'box_count', 'rejected_weight_kg',
            # Transport
            'vehicle_responsible', 'vehicle_responsible_display',
            'truck_head_id', 'trailer_id', 'driver_id',
            # Operator-entered transport details — sheet R23, R27, R28
            'truck_plate', 'driver_name', 'driver_phone',
            'transport_temp_c', 'transit_days',
            'has_peregruz', 'peregruz_city', 'peregruz_date',
            # Finance
            'price_per_kg', 'total_amount_usd',
            'is_gapy_satys',
            # Operational status (sheet rows 6, 14) + A2 customs planning
            'documents_status', 'harvest_status', 'customs_clearance_planned_day',
            # R4 — Şirin logs when transport dept handed docs over
            'transport_docs_given_at',
            # AD-1 Timestamps
            'loading_started_at', 'customs_entry_at', 'customs_exit_at',
            'departed_at', 'border_crossed_at', 'arrived_at',
            'sale_started_at', 'sale_ended_at',
            # Operator-entered datetime — sheet R31 (Arap logs destination entry)
            'dest_entry_at',
            # Operator-entered timestamp (NOT AD-1) — sheet R20
            'loading_ended_at',
            # Operator-entered date — sheet R43 (Aganazar files the report)
            'sales_report_date',
            # Operator-entered date — sheet R39 (Soltanmyrat logs harvest day)
            'harvest_date',
            # AD-2 Vehicle condition
            'vehicle_condition', 'vehicle_condition_note',
            # R15 — dispatcher's live status / ETA note (operator-entered, Haltaç)
            'vehicle_live_status',
            # Quality docs (flattened from OneToOne 'quality')
            'doc_azyk', 'doc_suriji', 'doc_hil', 'doc_kalibrowka',
            # Annotation — must be set in viewset queryset
            'has_sales_report',
            'has_doc_advance',
            # Notes
            'notes',
            'export_manager_note',
            'warehouse_note',
            'document_note',
            # R44 — Arap's destination-side freeform note
            'additional_notes_arap',
            # Sheet column tint (hex, e.g. '#ffe4b5') — null = default theme
            'column_color',
            # Inline related
            'firm_splits', 'block_sources', 'varieties_dominant',
            # Audit
            'created_by_name', 'created_by_role', 'created_at', 'updated_at',
        ]


class FirmSplitSerializer(serializers.ModelSerializer):
    export_firm_name = serializers.CharField(source='export_firm.name_en', read_only=True)

    class Meta:
        model = ShipmentFirmSplit
        fields = ['export_firm_id', 'export_firm_name', 'weight_kg', 'amount_usd', 'invoice_number']


class BlockSourceSerializer(serializers.ModelSerializer):
    block_code = serializers.CharField(source='block.code', read_only=True)
    block_name = serializers.CharField(source='block.name', read_only=True)

    class Meta:
        model = ShipmentBlockSource
        fields = ['block_code', 'block_name', 'weight_kg']


class StatusLogSerializer(serializers.ModelSerializer):
    status_code = serializers.CharField(source='status.code', read_only=True)
    status_display = serializers.CharField(source='status.name_en', read_only=True)
    changed_by_name = serializers.CharField(source='changed_by.username', read_only=True)

    class Meta:
        model = ShipmentStatusLog
        fields = [
            'status_code', 'status_display', 'changed_by_name',
            'changed_at', 'comment', 'is_auto',
        ]


class CommentSerializer(serializers.ModelSerializer):
    """READ serializer for shipment comments.

    Returns all display fields including denormalized user info, task state,
    and reply count. N+1-safe when called with select_related('user', 'assignee',
    'done_by') and prefetch_related('replies').
    """

    # === Author ===
    user_name = serializers.CharField(source='user.username', read_only=True)
    role = serializers.CharField(source='user.role', read_only=True)

    # === Task ===
    assignee_name = serializers.SerializerMethodField()
    done_by_name = serializers.SerializerMethodField()

    # === Mention summaries (denormalized so chip rendering doesn't N+1 the frontend) ===
    mentions_users = serializers.SerializerMethodField()
    role_mentions_list = serializers.SerializerMethodField()

    # === Reply count ===
    replies_count = serializers.SerializerMethodField()

    def get_assignee_name(self, obj) -> str | None:
        if obj.assignee_id is None:
            return None
        return obj.assignee.username if obj.assignee else None

    def get_done_by_name(self, obj) -> str | None:
        if obj.done_by_id is None:
            return None
        return obj.done_by.username if obj.done_by else None

    @staticmethod
    def user_chip(user) -> dict:
        """Build the {id, name, role} chip payload for one mentioned user."""
        full_name = ' '.join(p for p in [user.first_name, user.last_name] if p).strip()
        return {'id': user.id, 'name': full_name or user.username, 'role': user.role}

    def get_mentions_users(self, obj) -> list[dict]:
        # Resolve user IDs into {id, name, role} so chips can render names.
        ids = obj.mentions_ids
        if not ids:
            return []
        # Fast path: the list view pre-resolves every mentioned user across the
        # whole page into context['mention_users_map'] with a single query,
        # avoiding the N+1 that one query-per-comment would cause.
        chip_map = self.context.get('mention_users_map')
        if chip_map is not None:
            return [chip_map[i] for i in ids if i in chip_map]
        # Fallback for single-object serialization (detail / create response):
        # one query for this comment only — no N+1 since there's one object.
        from apps.core.models import User
        users = User.objects.filter(id__in=ids).only('id', 'username', 'first_name', 'last_name', 'role')
        return [self.user_chip(u) for u in users]

    def get_role_mentions_list(self, obj) -> list[dict]:
        # Return [{code, label}] so the frontend chip can show the human label.
        codes = obj.role_mentions_list
        if not codes:
            return []
        from apps.core.models.user import ROLE_CHOICES
        label_by_code = dict(ROLE_CHOICES)
        return [{'code': c, 'label': label_by_code.get(c, c)} for c in codes]

    def get_replies_count(self, obj) -> int:
        # Prefer prefetched replies (avoids N+1). The viewset's Prefetch already
        # filters is_deleted=False, so both branches return the same number.
        if hasattr(obj, '_prefetched_objects_cache') and 'replies' in obj._prefetched_objects_cache:
            return len(obj._prefetched_objects_cache['replies'])
        return obj.replies.filter(is_deleted=False).count()

    class Meta:
        model = ShipmentComment
        fields = [
            'id',
            'user_name',
            'role',
            'content',
            'field_key',
            'parent_comment',
            'is_system',
            'is_deleted',
            'assignee',
            'assignee_name',
            'is_done',
            'done_at',
            'done_by_name',
            'mentions_users',
            'role_mentions_list',
            'replies_count',
            'created_at',
            'updated_at',
        ]


class CommentCreateSerializer(serializers.Serializer):
    """WRITE serializer for creating a comment.

    Validates inputs and delegates to services.comments.create_comment.
    Querysets are evaluated lazily via get_fields() to avoid circular imports.
    """

    content = serializers.CharField(max_length=2000)
    field_key = serializers.CharField(max_length=64, required=False, allow_null=True, default=None)
    mentions = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        default=list,
    )
    role_mentions = serializers.ListField(
        child=serializers.CharField(max_length=30),
        required=False,
        default=list,
    )
    # Field names match the documented API contract (api-contract.md):
    # bare names without the _id suffix, since the serializer resolves them
    # to model instances before passing to the service.
    shipment = serializers.IntegerField(write_only=True)
    parent_comment = serializers.IntegerField(
        required=False, allow_null=True, default=None
    )
    assignee = serializers.IntegerField(
        required=False, allow_null=True, default=None
    )

    def validate(self, attrs: dict) -> dict:
        from apps.export.models import Shipment
        from apps.core.models import User

        # Resolve shipment
        try:
            attrs['shipment'] = Shipment.objects.get(pk=attrs['shipment'])
        except Shipment.DoesNotExist:
            raise serializers.ValidationError({'shipment': 'Shipment not found.'})

        # Resolve parent_comment
        parent_id = attrs.get('parent_comment')
        if parent_id is not None:
            try:
                attrs['parent_comment'] = ShipmentComment.objects.get(pk=parent_id)
            except ShipmentComment.DoesNotExist:
                raise serializers.ValidationError({'parent_comment': 'Comment not found.'})
        else:
            attrs['parent_comment'] = None

        # Resolve assignee
        assignee_id = attrs.get('assignee')
        if assignee_id is not None:
            try:
                attrs['assignee'] = User.objects.get(pk=assignee_id, is_active=True)
            except User.DoesNotExist:
                raise serializers.ValidationError({'assignee': 'User not found or inactive.'})
        else:
            attrs['assignee'] = None

        return attrs

    def create(self, validated_data: dict) -> ShipmentComment:
        from apps.export.services.comments import create_comment
        request = self.context.get('request')
        user = request.user if request else validated_data.pop('user', None)
        return create_comment(
            shipment=validated_data['shipment'],
            user=user,
            content=validated_data['content'],
            field_key=validated_data.get('field_key'),
            mentions=validated_data.get('mentions', []),
            role_mentions=validated_data.get('role_mentions', []),
            parent_comment=validated_data.get('parent_comment'),
            assignee=validated_data.get('assignee'),
        )

    def to_representation(self, instance: ShipmentComment) -> dict:
        # The write fields are IntegerFields but validate() resolved them into
        # model instances. After save(), DRF would re-serialize through those
        # IntegerFields and crash on `int(User_instance)`. Return the read shape
        # so callers receive the same object structure as GET /comments/.
        return CommentSerializer(instance, context=self.context).data


class MentionUserSerializer(serializers.Serializer):
    """Mentionable user representation for autocomplete."""

    type = serializers.SerializerMethodField()
    id = serializers.IntegerField()
    name = serializers.SerializerMethodField()
    role = serializers.CharField()

    def get_type(self, obj) -> str:
        return 'user'

    def get_name(self, obj) -> str:
        parts = [obj.first_name, obj.last_name]
        full = ' '.join(p for p in parts if p).strip()
        return full or obj.username


class MentionRoleSerializer(serializers.Serializer):
    """Mentionable role representation for autocomplete."""

    type = serializers.SerializerMethodField()
    code = serializers.CharField()
    label = serializers.CharField()
    member_count = serializers.IntegerField()

    def get_type(self, obj) -> str:
        return 'role'


class ShipmentDetailSerializer(ShipmentListSerializer):
    """Full detail serializer with all nested related objects.

    Used on GET /api/v1/export/shipments/{id}/ and returned by transition endpoint.
    """

    # Stable numeric identifier — named platform_id per api-contract field-naming convention.
    platform_id = serializers.IntegerField(source='id', read_only=True)

    firm_splits = FirmSplitSerializer(many=True, read_only=True)
    block_sources = BlockSourceSerializer(many=True, read_only=True)
    status_log = StatusLogSerializer(many=True, read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    quality = QualityDocumentSerializer(read_only=True)
    sales_report = SalesReportSerializer(read_only=True)
    status_code = serializers.CharField(source='status.code', read_only=True)
    allowed_transitions = serializers.SerializerMethodField()

    # Variety confidence display label.
    variety_confidence_display = serializers.CharField(
        source='get_variety_confidence_display', read_only=True
    )
    # All dominant varieties for multi-variety trucks.
    varieties_dominant = TomatoVarietyInlineSerializer(many=True, read_only=True)

    # D1 — task and phase context fields
    my_task = serializers.SerializerMethodField()
    other_tasks = serializers.SerializerMethodField()
    in_phase_seconds = serializers.SerializerMethodField()
    phase_avg_seconds = serializers.SerializerMethodField()
    # F — draft-promote readiness flag (true when shipment is in draft AND every
    # auto-resolving draft task is DONE/CANCELLED — manual_done tasks are
    # ignored from the readiness check; promotion is the user's call once
    # automation has done what it can).
    can_promote_from_draft = serializers.SerializerMethodField()

    # Supervisor roles that skip my_task auto-selection. They can browse all
    # tasks via other_tasks. Defined locally to avoid conflating with
    # PRIVILEGED_ROLES (which also gates write permissions, a separate concern).
    _SUPERVISOR_ROLES = frozenset({'export_manager', 'boss', 'admin', 'director'})

    def _get_tasks_prefetched(self, obj: 'Shipment') -> list:
        """Return prefetched tasks list, ordered by deadline asc nulls last, created_at asc.

        Works from the prefetch cache when ShipmentViewSet.retrieve prefetches
        'tasks'; falls back to a fresh queryset if called outside that context
        (e.g., unit tests that don't use the ViewSet).
        """
        if hasattr(obj, '_prefetched_objects_cache') and 'tasks' in obj._prefetched_objects_cache:
            # Already prefetched and ordered by the Prefetch object in the viewset.
            return list(obj._prefetched_objects_cache['tasks'])
        # Fallback: query with the same ordering
        from django.db.models import F
        return list(
            obj.tasks.select_related('rule', 'assignee_user')
            .order_by(F('deadline').asc(nulls_last=True), 'created_at')
        )

    def get_my_task(self, obj: 'Shipment') -> dict | None:
        """Return the requesting user's active task on this shipment, or null.

        Supervisors (export_manager, boss, admin, director) always get null —
        they see everything via other_tasks.

        Active states: OPEN, IN_PROGRESS, BLOCKED.
        When multiple active tasks match the user's role, pick the earliest
        deadline (nulls last), then oldest created_at.
        """
        request = self.context.get('request')
        if request is None:
            return None
        user = request.user
        role = getattr(user, 'role', None)

        if role in self._SUPERVISOR_ROLES:
            return None

        active_states = {TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED}
        tasks = self._get_tasks_prefetched(obj)

        for task in tasks:
            if task.assignee_role == role and task.state in active_states:
                return TaskDetailSerializer(task, context=self.context).data
        return None

    def get_other_tasks(self, obj: 'Shipment') -> list[dict]:
        """Return all tasks on this shipment except my_task.

        Includes done and cancelled tasks (rendered read-only on frontend).
        Ordered: deadline asc nulls last, then created_at asc.
        my_task is identified by the same role+state logic as get_my_task,
        so the first matching active task is excluded.
        """
        request = self.context.get('request')
        role = getattr(request.user, 'role', None) if request else None
        active_states = {TaskState.OPEN, TaskState.IN_PROGRESS, TaskState.BLOCKED}

        tasks = self._get_tasks_prefetched(obj)
        is_supervisor = role in self._SUPERVISOR_ROLES

        my_task_excluded = False
        result = []
        for task in tasks:
            if (
                not is_supervisor
                and not my_task_excluded
                and task.assignee_role == role
                and task.state in active_states
            ):
                # Skip the first role-matching active task (that's my_task).
                my_task_excluded = True
                continue
            result.append(TaskListSerializer(task, context=self.context).data)
        return result

    @staticmethod
    def _resolve_phase_entry(shipment: 'Shipment') -> 'datetime | None':
        """Find the datetime when the shipment entered its current phase.

        Delegates to the canonical implementation in services/phases.py so
        BoardItemSerializer can share the same logic without importing from
        another serializer class.
        """
        return resolve_phase_entry(shipment)

    def get_in_phase_seconds(self, obj: 'Shipment') -> int:
        """Integer seconds since the shipment entered its current phase.

        Uses the contiguous phase-run logic from _resolve_phase_entry().
        Returns 0 if no status log exists (safe fallback for draft shipments).
        """
        from django.utils import timezone as _tz
        phase_entry = self._resolve_phase_entry(obj)
        if phase_entry is None:
            return 0
        return int((_tz.now() - phase_entry).total_seconds())

    def get_phase_avg_seconds(self, obj: 'Shipment') -> int | None:
        """Average seconds other shipments in the same season spent in this status.

        Simplification (documented): this uses per-STATUS average, not per-phase
        average. For each closed shipment in the active season, we find consecutive
        log rows with the same status code and compute the elapsed time. This is
        simpler than the full phase-aware version and still provides useful signal.

        Result is cached for 5 minutes via Django's cache framework. The cache key
        is: phase_avg_seconds:{status_code}:{season_id}

        Returns None when there is no historical data.
        """
        from django.core.cache import cache

        status_code = obj.status.code if obj.status_id else None
        season_id = obj.season_id
        if not status_code or not season_id:
            return None

        cache_key = f'phase_avg_seconds:{status_code}:{season_id}'

        # Use explicit get/set with a sentinel to safely cache None results.
        _MISS = object.__new__(object)
        cached = cache.get(cache_key, _MISS)
        if cached is not _MISS:
            return cached

        result = self._compute_status_avg_seconds(status_code, season_id)
        cache.set(cache_key, result, 300)
        return result

    def get_can_promote_from_draft(self, obj: 'Shipment') -> bool:
        """True when the shipment is in draft AND every auto-resolving draft
        task is DONE/CANCELLED.

        Manual-done draft tasks (give_documents, give_documents_gapy) are
        excluded from the readiness check — they're the user's explicit
        action and don't gate promotion. The "Promote to Loading" button
        in the UI is the user's signal that they're done with prep
        regardless of those manual tasks.

        Used by the Detail page to surface a "Promote to Loading" button.
        Permission to actually call /assign/ is enforced server-side
        (export_manager / director only).
        """
        status_code = obj.status.code if obj.status_id else None
        if status_code != 'draft':
            return False

        tasks = self._get_tasks_prefetched(obj)
        # Only consider auto-resolving (target-field-driven) draft tasks.
        # MANUAL_DONE tasks are decoupled from promotion readiness.
        active = [
            t for t in tasks
            if t.step == 'draft'
            and t.completion_rule != TaskCompletionRule.MANUAL_DONE
            and t.state not in (TaskState.DONE, TaskState.CANCELLED)
        ]
        # No auto-resolving draft tasks active → ready (covers the case of
        # a draft created before the engine, or one with no applicable rules).
        return len(active) == 0

    @staticmethod
    def _compute_status_avg_seconds(status_code: str, season_id: int) -> int | None:
        """Compute mean seconds-in-status across closed shipments for status_code.

        For each closed (tamamlandy) shipment in the season that passed through
        this status, find the log entry for this status and the subsequent log
        entry (the transition OUT of this status). Elapsed time = next.changed_at
        - this.changed_at.

        Simplified from full phase-aware version: per-status granularity, which
        is sufficient for the Detail page context strip.

        Returns integer mean seconds, or None if no data.
        """
        from apps.export.models import ShipmentStatusLog

        # Fetch all logs for closed shipments in this season that passed through
        # status_code. Ordered by (shipment_id, changed_at asc) so we can walk
        # consecutive entries per shipment.
        logs = list(
            ShipmentStatusLog.objects.filter(
                shipment__season_id=season_id,
                shipment__status__code='tamamlandy',
            )
            .select_related('status')
            .order_by('shipment_id', 'changed_at')
        )

        # Group by shipment_id
        from itertools import groupby

        durations: list[float] = []
        for _sid, group in groupby(logs, key=lambda lg: lg.shipment_id):
            entries = list(group)
            for i, log in enumerate(entries):
                if log.status.code != status_code:
                    continue
                # Found the entry into this status; the next log is the exit.
                if i + 1 < len(entries):
                    elapsed = (entries[i + 1].changed_at - log.changed_at).total_seconds()
                    if elapsed >= 0:
                        durations.append(elapsed)
                # If no next log, the shipment ended at this status — skip.

        if not durations:
            return None
        return int(sum(durations) / len(durations))

    def get_allowed_transitions(self, obj: Shipment) -> list[str]:
        if obj.status is None:
            return []
        current_code = obj.status.code
        return [
            _edge_to(edge)
            for edge in TRANSITIONS.get(current_code, [])
            if _edge_to(edge) != 'cancelled'
        ]

    class Meta(ShipmentListSerializer.Meta):
        # harvest_age_days and freshness are inherited from ShipmentListSerializer
        # (both the SerializerMethodField declarations and their getter methods).
        # NOTE: scalar shipment fields (box_count, timestamps, notes, vehicle_*,
        # status_code, variety, import_firm, created_at, etc.) now live on
        # ShipmentListSerializer.Meta.fields and are inherited — do not re-list
        # them here, or a future removal from the base would be silently masked.
        # Only detail-exclusive fields (nested objects, FK ids for the edit
        # drawer, task/phase context) are added below.
        fields = ShipmentListSerializer.Meta.fields + [
            'platform_id',
            'allowed_transitions',
            'variety_confidence',
            'variety_confidence_display',
            'varieties_dominant',
            'quality',
            'sales_report',
            'firm_splits',
            'block_sources',
            'status_log',
            'comments',
            # FK ids exposed for the web-management Edit drawer (frontend dropdowns).
            # Names are already on ShipmentListSerializer; ids let the drawer pre-select.
            # (country/customer/city/variety/import_firm ids: variety + import_firm
            # are inherited from the list serializer; the rest are detail-only.)
            'country',
            'customer',
            'city',
            'border_point',
            'loading_location',
            # D1 — task and phase context
            'my_task',
            'other_tasks',
            'in_phase_seconds',
            'phase_avg_seconds',
            # F — draft-promote readiness flag
            'can_promote_from_draft',
        ]


# All fields a user could potentially PATCH on Shipment (superset of all roles).
# AD-1 timestamps are intentionally excluded — they are set ONLY by transition_to().
# Exception: loading_started_at is now operator-entered (no longer AD-1) — see
# sheet_rows.py R19 input_type='datetime' and create_shipment() (no auto-set).
_ALL_PATCHABLE_FIELDS = {
    # Identifiers
    'official_export_code',
    # Weight / packaging
    'box_count', 'pallet_count', 'pallet_weight_kg', 'packaging_kg',
    'weight_net', 'weight_gross', 'rejected_weight_kg',
    # Geography / customer
    'country', 'city', 'customer', 'import_firm',
    'border_point', 'loading_location',
    # Product
    'product_type', 'variety', 'variety_confidence',
    # Transport
    'vehicle_condition', 'vehicle_condition_note',
    'vehicle_responsible', 'vehicle_live_status',
    'truck_head_id', 'trailer_id', 'driver_id',
    # Operator-entered transport details — sheet R23, R27, R28
    'truck_plate', 'driver_name', 'driver_phone',
    'transit_days', 'transport_temp_c', 'shelf_life_days',
    'has_peregruz', 'peregruz_city', 'peregruz_date',
    # Operator-entered timestamps — sheet R19/R20/R21/R25/R30/R31/R32/R35/R41/R42.
    # AD-1 is retired; every lifecycle timestamp is operator-entered now.
    'loading_started_at',
    'loading_ended_at',
    'departed_at',
    'customs_exit_at',
    'border_crossed_at',
    'dest_entry_at',
    'customs_entry_at',
    'arrived_at',
    'sale_started_at',
    'sale_ended_at',
    # Operator-entered date — sheet R43
    'sales_report_date',
    # Operator-entered date — sheet R39 (harvest day)
    'harvest_date',
    # Operational status
    'documents_status', 'harvest_status', 'customs_clearance_planned_day',
    # R4 — Şirin logs when transport dept handed docs over
    'transport_docs_given_at',
    # Finance
    'price_per_kg', 'total_amount_usd',
    # Flags
    'is_gapy_satys',
    # Notes
    'notes',
    'export_manager_note',
    'warehouse_note',
    'document_note',
    # R44 — Arap's destination-side freeform note
    'additional_notes_arap',
    # Sheet column tint (admin + export_manager only via wildcard grants)
    'column_color',
}


class ShipmentPatchSerializer(serializers.ModelSerializer):
    """Handles PATCH /api/v1/export/shipments/{id}/

    Validates that the requesting user's role is allowed to edit each field
    they submitted. Unknown or unpermitted fields raise a 403-worthy error
    (raised in the view, not here — this serializer just strips them).

    Raises ValueError listing forbidden fields when validation fails.
    """

    # Stream G follow-up: official_export_code (Shipment Code) is free text.
    # Soltanmyrat generates the code himself with whatever format the operation
    # uses today (variety + block conventions evolve). The strict 6-field
    # `DD|MM|NNN|BLK|YY|VV` validator was rejecting operationally-valid codes,
    # so we allow any non-blank string up to max_length.
    official_export_code = serializers.CharField(
        max_length=30,
        required=False,
        allow_blank=True,
        allow_null=True,
    )

    class Meta:
        model = Shipment
        fields = list(_ALL_PATCHABLE_FIELDS)

    def validate(self, attrs: dict) -> dict:
        role = self.context.get('role')
        if role in PRIVILEGED_ROLES:
            return attrs
        # column_color is a UI tint, not domain data — open to every Sheet
        # viewer regardless of their per-field grants on shipment.
        forbidden = [
            f for f in attrs
            if f != 'column_color' and not can_edit_field(role, f)
        ]
        if forbidden:
            raise serializers.ValidationError(
                {f: f"Role '{role}' cannot edit this field." for f in forbidden}
            )
        return attrs


class BlockSourceInputSerializer(serializers.Serializer):
    """One row of the multi-block composer: block + allocated weight.

    Used as a child serializer inside ShipmentCreateSerializer.block_sources.
    """

    block_id = serializers.PrimaryKeyRelatedField(queryset=GreenhouseBlock.objects.all())
    weight_kg = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0.01'))


class FirmSplitInputSerializer(serializers.Serializer):
    """One row of the firm split composer: export firm + weight + optional amount.

    Used as a child serializer inside ShipmentCreateSerializer.firm_splits.
    """

    export_firm = serializers.PrimaryKeyRelatedField(queryset=ExportFirm.objects.all())
    weight_kg = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0.01'))
    amount_usd = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )
    split_order = serializers.IntegerField(default=1, required=False)


class ShipmentCreateSerializer(serializers.Serializer):
    """Validates the request body for POST /api/v1/export/shipments/.

    Enforces cargo_code format and uniqueness before creating a Shipment.

    Two modes:
    - is_draft=False (default): full creation at yuklenme (legacy path). country/customer
      are optional at the serializer level but the view still restricts this to privileged
      roles.
    - is_draft=True: supply-side draft. block_sources (≥1 item) is required.
      country/customer/city may be null — destination is decided during assignment.

    New in two-column join flow: variety, import_firm, firm_splits, skip_forecast_check
    are all optional on the draft path. When skip_forecast_check=True the forecast-pool
    cap is bypassed (for ad-hoc in-Sheet supply drafts with no prior forecast).
    """

    # cargo_code is the auto-generated platform code. Optional on input —
    # generated server-side if omitted (Stream F-followup). Soltanmyrat enters
    # the physical pallet tag separately via official_export_code.
    cargo_code = serializers.CharField(max_length=20, required=False, allow_blank=True)
    # Stream G follow-up: free-text Shipment Code (no 6-field format check).
    official_export_code = serializers.CharField(
        max_length=30,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    # date is optional — defaults to today on create. loading_started_at is
    # operator-entered on the Sheet (R19) and is not set by create.
    date = serializers.DateField(required=False)
    country = serializers.PrimaryKeyRelatedField(
        queryset=Country.objects.all(), required=False, allow_null=True
    )
    customer = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), required=False, allow_null=True
    )
    season = serializers.PrimaryKeyRelatedField(
        queryset=Season.objects.all(), required=False, allow_null=True
    )
    # Product / sort — Soltanmyrat's variety (optional at draft time)
    variety = serializers.PrimaryKeyRelatedField(
        queryset=TomatoVariety.objects.all(), required=False, allow_null=True
    )
    # Multi-variety support: ordered list of 1–4 TomatoVariety IDs, first entry
    # is the primary (dominant) variety. When provided, sets varieties_dominant
    # M2M and mirrors varieties[0] into the scalar variety FK for back-compat.
    # Mutually compatible with the single `variety` field — if only `variety` is
    # given, varieties_dominant is NOT auto-populated (pass `varieties` explicitly).
    varieties = serializers.PrimaryKeyRelatedField(
        queryset=TomatoVariety.objects.all(),
        many=True,
        required=False,
    )
    # Destination import firm (optional at draft time)
    import_firm = serializers.PrimaryKeyRelatedField(
        queryset=ImportFirm.objects.all(), required=False, allow_null=True
    )
    is_draft = serializers.BooleanField(default=False)
    block_sources = BlockSourceInputSerializer(many=True, required=False, default=list)
    # Export firm splits — 1-3 firms with per-firm weight and optional amount
    firm_splits = FirmSplitInputSerializer(many=True, required=False, default=list)
    # When True, skip forecast-pool cap check. Intended for in-Sheet ad-hoc
    # supply drafts that have no prior HarvestDayEntry forecast. The block
    # sources still count toward allocated_kg for future checks.
    skip_forecast_check = serializers.BooleanField(default=False)
    notes = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate_varieties(self, value: list) -> list:
        """Enforce 1–4 unique entries when varieties list is provided.

        DRF's PrimaryKeyRelatedField(many=True) validates existence automatically.
        This validator guards against exceeding the 4-variety maximum and against
        duplicate IDs (consistent with block_sources / firm_splits dedup rules).
        """
        if len(value) > 4:
            raise serializers.ValidationError(
                'A shipment may carry at most 4 dominant varieties.'
            )
        ids = [v.pk for v in value]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError(
                'Duplicate variety IDs are not allowed.'
            )
        return value

    def validate_cargo_code(self, value: str) -> str:
        """Validate format DDMM###/YY when a cargo_code is supplied.

        Empty/blank values are permitted — the create view will auto-generate
        a code in that case (Stream F-followup).
        """
        if not value:
            return value
        if not re.match(r'^\d{7}/\d{2}$', value):
            raise serializers.ValidationError(
                "Cargo code must match pattern NNNNNNN/YY (e.g. 0201045/25)"
            )
        if Shipment.objects.filter(cargo_code=value).exists():
            raise serializers.ValidationError(
                "A shipment with this cargo code already exists"
            )
        return value

    def validate(self, attrs: dict) -> dict:
        """Cross-field validation for draft vs. full-creation paths."""
        import datetime
        from decimal import Decimal as D

        block_sources = attrs.get('block_sources', [])
        firm_splits = attrs.get('firm_splits', [])

        # Stream F: drafts no longer REQUIRE block sources at creation time. The
        # supply-side DraftPool flow still includes them voluntarily; the
        # standard ShipmentCreateModal creates lightweight drafts without
        # them, and block sources can be added later through the Sheet/Detail
        # edit paths. The original strictness was an artifact of DraftPool's
        # use case, not an intrinsic property of the draft state.

        # Validate block uniqueness within the submitted list (when provided).
        if block_sources:
            block_ids = [row['block_id'].id for row in block_sources]
            if len(block_ids) != len(set(block_ids)):
                raise serializers.ValidationError(
                    {'block_sources': 'Duplicate blocks are not allowed in a single shipment.'}
                )

        # Validate firm_splits uniqueness within the submitted list.
        if firm_splits:
            firm_ids = [row['export_firm'].id for row in firm_splits]
            if len(firm_ids) != len(set(firm_ids)):
                raise serializers.ValidationError(
                    {'firm_splits': 'Duplicate export firms are not allowed in a single shipment.'}
                )

        # Block weight validation (draft path only, when block_sources provided).
        # Two caps are applied when `enforce_caps` is True (normal one-truck drafts):
        #   Cap 1: 18,500 kg physical truck capacity per block.
        #   Cap 2: remaining forecast pool per block on the shipment date.
        #
        # Supply-column drafts (skip_forecast_check=True) aggregate an entire day's
        # supply across multiple trucks and may legitimately exceed 18,500 kg.  They
        # are split/joined downstream, so BOTH caps are intentionally skipped for
        # them.  The forecast-first one-truck draft path (skip_forecast_check=False)
        # keeps both caps in full force.
        is_draft = attrs.get('is_draft', False)
        skip_forecast_check = attrs.get('skip_forecast_check', False)
        enforce_caps = is_draft and block_sources and not skip_forecast_check

        if enforce_caps:
            # Cap 1: truck capacity.
            truck_errors = {}
            for i, row in enumerate(block_sources):
                block = row['block_id']
                weight_kg = D(str(row['weight_kg']))
                block_code = getattr(block, 'code', str(block.pk))
                if weight_kg > D('18500'):
                    truck_errors[f'block_sources[{i}]'] = (
                        f'Block {block_code}: weight {weight_kg} kg exceeds the '
                        f'18,500 kg truck capacity.'
                    )
            if truck_errors:
                raise serializers.ValidationError({'block_sources': truck_errors})

            # Cap 2: forecast pool.
            # Uses a single get_remaining_for_date() call (one grouped DB query, no N+1).
            from apps.export.services.harvest_forecast import get_remaining_for_date

            ship_date = attrs.get('date') or datetime.date.today()
            remaining_rows = get_remaining_for_date(ship_date)
            remaining_map: dict[int, D] = {
                row['block_id']: row['remaining_kg']
                for row in remaining_rows
            }

            forecast_errors = {}
            for i, row in enumerate(block_sources):
                block = row['block_id']
                weight_kg = D(str(row['weight_kg']))
                block_code = getattr(block, 'code', str(block.pk))
                remaining = remaining_map.get(block.pk)
                if remaining is None:
                    forecast_errors[f'block_sources[{i}]'] = (
                        f'Block {block_code}: no forecast has been entered for '
                        f'{ship_date}. Submit a forecast before creating a draft.'
                    )
                elif weight_kg > remaining:
                    forecast_errors[f'block_sources[{i}]'] = (
                        f'Block {block_code}: only {remaining} kg of forecast '
                        f'remaining on {ship_date} (requested {weight_kg} kg).'
                    )

            if forecast_errors:
                raise serializers.ValidationError({'block_sources': forecast_errors})

        return attrs


class ShipmentAssignSerializer(serializers.Serializer):
    """Request body for POST /api/v1/export/shipments/{id}/assign/.

    Accepts destination and customer fields that were deferred at draft creation.
    All fields are optional so partial assignment is possible; the transition_to()
    call (yuklenme) enforces that the shipment is in a valid state for loading.
    """

    country = serializers.PrimaryKeyRelatedField(
        queryset=Country.objects.all(), required=False, allow_null=True
    )
    city = serializers.PrimaryKeyRelatedField(
        queryset=City.objects.all(), required=False, allow_null=True
    )
    customer = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), required=False, allow_null=True
    )
    import_firm = serializers.PrimaryKeyRelatedField(
        queryset=ImportFirm.objects.all(), required=False, allow_null=True
    )


class ShipmentJoinSerializer(serializers.Serializer):
    """Request body for POST /api/v1/export/shipments/{id}/join/.

    Merges a supply draft (source) into a destination draft (target).
    The target is identified by the URL pk; the source is provided in the body.
    """

    source_id = serializers.IntegerField(min_value=1)


class ShipmentSwapSerializer(serializers.Serializer):
    """Request body for POST /api/v1/export/shipments/{a_id}/swap/.

    Exchanges the values of selected scalar (and FK) fields between two
    shipments.  ``other_id`` identifies the second shipment; ``fields`` is
    a non-empty list of field names drawn from SWAPPABLE_FIELDS.
    """

    other_id = serializers.IntegerField(min_value=1)
    fields = serializers.ListField(
        child=serializers.CharField(max_length=80),
        min_length=1,
        allow_empty=False,
    )


# ---------------------------------------------------------------------------
# FinansistAdvance serializers
# ---------------------------------------------------------------------------

class AdvanceShipmentSerializer(serializers.ModelSerializer):
    """Nested serializer for a single shipment link inside an advance."""

    shipment_cargo_code = serializers.CharField(
        source='shipment.cargo_code', read_only=True
    )

    class Meta:
        model = FinansistAdvanceShipment
        fields = ['shipment', 'shipment_cargo_code', 'allocated_amount']


class FinansistAdvanceListSerializer(serializers.ModelSerializer):
    """Lightweight list serializer — no shipment rows, just aggregated counts.

    Used by GET /api/v1/export/advances/.
    """

    issued_by_name = serializers.CharField(source='issued_by.username', read_only=True)
    # Read from queryset annotations (set in FinansistAdvanceViewSet.get_queryset)
    # to avoid N+1 queries on the list endpoint.
    shipment_count = serializers.IntegerField(source='shipment_count_ann', read_only=True)
    allocated_total = serializers.DecimalField(
        source='allocated_total_ann', max_digits=12, decimal_places=2, read_only=True
    )

    class Meta:
        model = FinansistAdvance
        fields = [
            'id',
            'batch_code',
            'advance_date',
            'total_amount',
            'currency',
            'purpose',
            'issued_by',
            'issued_by_name',
            'reconciled',
            'reconciled_at',
            'created_at',
            'shipment_count',
            'allocated_total',
        ]


class FinansistAdvanceDetailSerializer(FinansistAdvanceListSerializer):
    """Full detail serializer — adds shipment links and notes.

    Used by GET /api/v1/export/advances/{id}/.
    """

    shipment_links = AdvanceShipmentSerializer(many=True, read_only=True)

    class Meta(FinansistAdvanceListSerializer.Meta):
        fields = FinansistAdvanceListSerializer.Meta.fields + [
            'notes',
            'shipment_links',
        ]


class FinansistAdvanceCreateSerializer(serializers.Serializer):
    """Validates POST /api/v1/export/advances/ request body.

    Accepts an optional list of shipment IDs to link at creation time.
    Each ID is validated to exist before the advance record is written.
    """

    batch_code = serializers.CharField(max_length=50, required=False, allow_blank=True)
    advance_date = serializers.DateField()
    total_amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    currency = serializers.CharField(max_length=10, default='USD')
    purpose = serializers.CharField(max_length=200, required=False, allow_blank=True)
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True)
    shipment_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        allow_empty=True,
        default=list,
    )

    def validate_shipment_ids(self, ids: list[int]) -> list[int]:
        """Ensure all provided shipment IDs exist in the database."""
        if not ids:
            return ids
        found_ids = set(
            Shipment.objects.filter(id__in=ids).values_list('id', flat=True)
        )
        missing = [sid for sid in ids if sid not in found_ids]
        if missing:
            raise serializers.ValidationError(
                f"Shipment IDs not found: {missing}"
            )
        return ids


# ---------------------------------------------------------------------------
# Pallet manifest serializers
# ---------------------------------------------------------------------------


class PalletSerializer(serializers.ModelSerializer):
    """Read/write serializer for a single pallet manifest entry.

    shipment is set by the view (URL param), not by the client.
    net_weight_kg is a read-only computed field derived from the Pallet property.
    """

    # Read-only enriched fields
    crate_type_name = serializers.CharField(source='crate_type.name', read_only=True)
    crate_type_weight_kg = serializers.DecimalField(
        source='crate_type.weight_kg', max_digits=6, decimal_places=3, read_only=True,
    )
    net_weight_kg = serializers.SerializerMethodField()
    variety_code = serializers.CharField(source='variety.code', read_only=True)
    variety_name = serializers.CharField(source='variety.name', read_only=True)
    sub_block_code = serializers.CharField(source='sub_block.code', read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)

    def get_net_weight_kg(self, obj: Pallet) -> Decimal:
        """Return the computed net weight via the model property."""
        return obj.net_weight_kg

    def validate(self, attrs):
        """Ensure computed net weight will be positive (data entry guard)."""
        gross = attrs.get('gross_weight_kg', getattr(self.instance, 'gross_weight_kg', Decimal('0')))
        pallet_w = attrs.get('pallet_weight_kg', getattr(self.instance, 'pallet_weight_kg', Decimal('0')))
        additions = attrs.get('additions_kg', getattr(self.instance, 'additions_kg', Decimal('0')))
        crate_type = attrs.get('crate_type', getattr(self.instance, 'crate_type', None))
        crate_count = attrs.get('crate_count', getattr(self.instance, 'crate_count', 0))

        if crate_type is not None:
            crate_total = crate_type.weight_kg * crate_count
            net = gross - crate_total - pallet_w - additions
            if net <= 0:
                raise serializers.ValidationError(
                    {'gross_weight_kg': 'Computed net weight must be positive. Check gross, crate, and pallet weights.'}
                )
        return attrs

    class Meta:
        model = Pallet
        fields = [
            'id',
            'pallet_number',
            'crate_type',
            'crate_type_name',
            'crate_type_weight_kg',
            'crate_count',
            'gross_weight_kg',
            'pallet_weight_kg',
            'additions_kg',
            'net_weight_kg',
            'variety',
            'variety_code',
            'variety_name',
            'sub_block',
            'sub_block_code',
            'loaded_at',
            'created_by_name',
        ]
        read_only_fields = [
            'id',
            'crate_type_name',
            'crate_type_weight_kg',
            'net_weight_kg',
            'variety_code',
            'variety_name',
            'sub_block_code',
            'created_by_name',
        ]


class PalletBulkUpsertSerializer(serializers.Serializer):
    """Accepts { "pallets": [...] } for bulk upsert of all pallets on a shipment.

    Replaces all existing pallets for the shipment on success.
    """

    pallets = PalletSerializer(many=True)

    def validate_pallets(self, pallets: list) -> list:
        if not pallets:
            raise serializers.ValidationError('pallets list must not be empty.')
        # Pallet numbers must be unique within the submitted batch
        numbers = [p.get('pallet_number') for p in pallets]
        if len(numbers) != len(set(numbers)):
            raise serializers.ValidationError(
                'Duplicate pallet_number values in the submitted list.'
            )
        return pallets


class VarietyOverrideSerializer(serializers.Serializer):
    """Accepts { "variety_ids": [int, ...] } for manual dominant-variety override.

    Allows 1-4 variety IDs. First entry becomes the #1 dominant (shipment.variety).
    """

    variety_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        min_length=1,
        max_length=4,
    )

    def validate_variety_ids(self, ids: list[int]) -> list[int]:
        """Ensure all provided variety IDs exist."""
        from apps.core.models import TomatoVariety
        found = set(TomatoVariety.objects.filter(id__in=ids).values_list('id', flat=True))
        missing = [vid for vid in ids if vid not in found]
        if missing:
            raise serializers.ValidationError(f'TomatoVariety IDs not found: {missing}')
        return ids


# ---------------------------------------------------------------------------
# Task serializers (B-api sub-PR)
# ---------------------------------------------------------------------------

class TaskListSerializer(serializers.ModelSerializer):
    """Lightweight task serializer for list endpoints.

    N+1-safe when the queryset has select_related('shipment', 'rule', 'assignee_user').
    """

    # Denormalized cargo code from the parent shipment.
    shipment_cargo_code = serializers.CharField(
        source='shipment.cargo_code', read_only=True,
    )

    # Phase derived from the parent shipment's current status code via PHASE_MAP.
    phase = serializers.SerializerMethodField()

    # Parsed CSV list exposed as a JSON array.
    target_fields_list = serializers.SerializerMethodField()

    # Denormalized assignee user name.
    assignee_user_name = serializers.CharField(
        source='assignee_user.username', read_only=True, default=None,
    )

    # is_overdue is a model property — expose it as a read field.
    is_overdue = serializers.BooleanField(read_only=True)

    def get_phase(self, obj) -> str | None:
        """Resolve phase from the task's parent shipment status.

        Returns None when the task has no linked shipment. Returns 'CLOSE'
        for unknown or terminal status codes (via resolve_phase fallback).
        """
        if obj.shipment_id is None or obj.shipment is None:
            return None
        status = getattr(obj.shipment, 'status', None)
        code = getattr(status, 'code', None)
        return resolve_phase(code)

    def get_target_fields_list(self, obj) -> list[str]:
        return obj.target_field_list

    class Meta:
        model = Task
        fields = [
            'id',
            'shipment',
            'shipment_cargo_code',
            'step',
            'phase',
            'title_key',
            'assignee_role',
            'assignee_user',
            'assignee_user_name',
            'target_fields_list',
            'completion_rule',
            'deadline',
            'deadline_rule',
            'state',
            'is_overdue',
            'created_at',
            'started_at',
            'completed_at',
            # Stream G: surfaced on the list serializer so the Detail page's
            # OtherTasksRow can show the reason in its Unblock modal without
            # needing a separate /tasks/:id/ fetch per blocked card.
            'blocked_reason',
        ]
        read_only_fields = fields


class TaskDetailSerializer(TaskListSerializer):
    """Full task detail serializer — extends list with blocking info and duration.

    Used by the /tasks/{id}/ retrieve action.
    """

    # IDs of tasks that block this one.
    blocked_by = serializers.SerializerMethodField()

    # Duration in seconds from started_at to completed_at (or now).
    duration_seconds = serializers.IntegerField(read_only=True)

    def get_blocked_by(self, obj) -> list[int]:
        return list(obj.blocked_by.values_list('id', flat=True))

    class Meta(TaskListSerializer.Meta):
        fields = TaskListSerializer.Meta.fields + [
            'blocked_reason',
            'blocked_by',
            'rule',
            'duration_seconds',
        ]
        read_only_fields = fields


class TaskBlockSerializer(serializers.Serializer):
    """Input serializer for the /tasks/{id}/block/ action."""

    reason = serializers.CharField(max_length=500)


class BoardItemSerializer(serializers.ModelSerializer):
    """Lightweight per-shipment row for the Shipment Kanban board.

    Designed for GET /api/v1/export/shipments/board/ — one instance per
    shipment in a phase column. All expensive aggregation (task counts, late
    counts) is pre-computed by the viewset queryset via DB-side COUNT/filter
    annotations; this serializer only reads already-annotated values.

    time_in_phase_seconds is derived from the most-recent ShipmentStatusLog
    entry (annotated as ``last_status_change``), falling back to
    ``updated_at``. This approximates "time in current status." A more
    precise "time in current phase" would require a ShipmentStatusLog walk
    correlated against PHASE_MAP per shipment — that's out of scope for D3
    (Stream E introduces status_changed_at to do this cheaply).

    owner_role: returns the assignee_role of the most-recently-created task
    on this shipment (from the prefetched tasks queryset). Falls back to None
    if there are no tasks.
    """

    # cargo_code IS the model attribute name (db_column='code' is the raw
    # SQL column, but Django maps it to .cargo_code). No source= needed.
    cargo_code = serializers.CharField(read_only=True)
    phase = serializers.SerializerMethodField()
    owner_role = serializers.SerializerMethodField()
    time_in_phase_seconds = serializers.SerializerMethodField()

    # Annotated by the viewset queryset — read as plain integers.
    tasks_done = serializers.IntegerField(read_only=True)
    tasks_total = serializers.IntegerField(read_only=True)
    late_count = serializers.IntegerField(read_only=True)
    in_progress_count = serializers.IntegerField(read_only=True)
    blocked_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Shipment
        fields = [
            'id',
            'cargo_code',
            'phase',
            'owner_role',
            'time_in_phase_seconds',
            'tasks_done',
            'tasks_total',
            'late_count',
            'in_progress_count',
            'blocked_count',
        ]
        read_only_fields = fields

    def get_phase(self, obj) -> str:
        """Resolve phase from current status code."""
        code = obj.status.code if obj.status_id else None
        return resolve_phase(code)

    def get_owner_role(self, obj) -> str | None:
        """Assignee role of the most-recently-created task on this shipment.

        Reads from the prefetched tasks queryset (ordered by -created_at).
        Returns None when the shipment has no tasks.
        """
        tasks = obj.tasks.all()
        if not tasks:
            return None
        # tasks is prefetched ordered by -created_at (set in the viewset).
        return tasks[0].assignee_role

    def get_time_in_phase_seconds(self, obj) -> int | None:
        """Seconds since the shipment entered its current phase.

        Uses resolve_phase_entry() from services/phases.py which walks the
        prefetched status_log to find the earliest contiguous log entry for
        the current phase. This requires the board viewset queryset to prefetch
        status_log with select_related('status').

        Falls back to status_changed_at (new AD-1 field) if the status_log
        walk returns None, and finally to updated_at. Returns None only when
        no reference timestamp is available at all.
        """
        from django.utils import timezone

        phase_entry = resolve_phase_entry(obj)
        if phase_entry is not None:
            return int((timezone.now() - phase_entry).total_seconds())

        # Fallback: use status_changed_at (set by transition_to)
        ref = obj.status_changed_at or obj.updated_at
        if ref is None:
            return None
        return int((timezone.now() - ref).total_seconds())
