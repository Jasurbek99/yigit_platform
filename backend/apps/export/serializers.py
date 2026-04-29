import re
from decimal import Decimal

from rest_framework import serializers

from apps.core.models import City, Country, Customer, ImportFirm, Season, GreenhouseBlock, TomatoVariety
from apps.core.permissions import can_edit_field, PRIVILEGED_ROLES
from apps.export.services import TRANSITIONS
from apps.export.validators import validate_official_export_code
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
    status_step = serializers.IntegerField(source='status.step_order', read_only=True)
    country_name = serializers.CharField(source='country.name_en', read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    city_name = serializers.CharField(source='city.name', read_only=True, default=None)
    variety_name = serializers.CharField(source='variety.name', read_only=True, default=None)
    border_point_name = serializers.CharField(source='border_point.name', read_only=True, default=None)

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
            'status_step',
            'country_name',
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


class SheetFirmSplitInlineSerializer(serializers.ModelSerializer):
    """Inline firm split for sheet view — minimal fields."""

    firm_code = serializers.CharField(source='export_firm.code', read_only=True)
    firm_name = serializers.CharField(source='export_firm.name_en', read_only=True)

    class Meta:
        model = ShipmentFirmSplit
        fields = ['firm_code', 'firm_name', 'weight_kg', 'amount_usd']


class SheetBlockSourceInlineSerializer(serializers.ModelSerializer):
    """Inline block source for sheet view — minimal fields."""

    block_code = serializers.CharField(source='block.code', read_only=True)

    class Meta:
        model = ShipmentBlockSource
        fields = ['block_code', 'weight_kg']


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
    city_name = serializers.CharField(source='city.name', read_only=True, default=None)
    border_point_name = serializers.CharField(source='border_point.name', read_only=True, default=None)

    # Customer
    customer_name = serializers.CharField(source='customer.name', read_only=True, default=None)
    import_firm_name = serializers.CharField(source='import_firm.name_en', read_only=True, default=None)

    # Product — variety.code is the official registry code (01-10, E1-E3)
    variety_name = serializers.CharField(source='variety.name', read_only=True, default=None)
    variety_code = serializers.CharField(source='variety.code', read_only=True, default=None)
    variety_confidence = serializers.CharField(read_only=True)

    # Transport
    vehicle_responsible_display = serializers.CharField(source='vehicle_responsible', read_only=True)

    # Audit
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, default=None)

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

    # Annotated by viewset — Count('comments', filter=Q(comments__user__role=...))
    # Used by sheet rows R17 (Soltanmyrat) and R18 (Şirin) — click-through summary cells.
    warehouse_comment_count = serializers.IntegerField(read_only=True)
    document_comment_count = serializers.IntegerField(read_only=True)

    # Inline related data
    firm_splits = SheetFirmSplitInlineSerializer(many=True, read_only=True)
    block_sources = SheetBlockSourceInlineSerializer(many=True, read_only=True)

    class Meta:
        model = Shipment
        fields = [
            # Identifiers
            'id', 'cargo_code', 'official_export_code', 'date',
            # Status
            'status', 'status_display', 'status_code', 'status_step',
            # Geography
            'country', 'country_name', 'country_code',
            'city', 'city_name',
            'border_point', 'border_point_name',
            # Customer
            'customer', 'customer_name',
            'import_firm', 'import_firm_name',
            # Product
            'variety', 'variety_name', 'variety_code', 'variety_confidence',
            # Weight
            'weight_gross', 'weight_net', 'packaging_kg',
            'pallet_count', 'box_count', 'rejected_weight_kg',
            # Transport
            'vehicle_responsible', 'vehicle_responsible_display',
            'truck_head_id', 'trailer_id', 'driver_id',
            'transport_temp_c', 'transit_days',
            'has_peregruz', 'peregruz_city', 'peregruz_date',
            # Finance
            'price_per_kg', 'total_amount_usd',
            'is_gapy_satys',
            # Operational status (sheet rows 5, 6, 14)
            'customs_clearance', 'documents_status', 'harvest_status',
            # AD-1 Timestamps
            'loading_started_at', 'customs_entry_at', 'customs_exit_at',
            'departed_at', 'border_crossed_at', 'arrived_at',
            'sale_started_at', 'sale_ended_at',
            # AD-2 Vehicle condition
            'vehicle_condition', 'vehicle_condition_note', 'route_note',
            # Quality docs (flattened from OneToOne 'quality')
            'doc_azyk', 'doc_suriji', 'doc_hil', 'doc_kalibrowka',
            # Annotation — must be set in viewset queryset
            'has_sales_report',
            'has_doc_advance',
            'warehouse_comment_count',
            'document_comment_count',
            # Notes
            'notes',
            # Inline related
            'firm_splits', 'block_sources',
            # Audit
            'created_by_name', 'created_at', 'updated_at',
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
    status_display = serializers.CharField(source='status.name_en', read_only=True)
    changed_by_name = serializers.CharField(source='changed_by.username', read_only=True)

    class Meta:
        model = ShipmentStatusLog
        fields = ['status_display', 'changed_by_name', 'changed_at', 'comment']


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

    def get_mentions_users(self, obj) -> list[dict]:
        # Resolve user IDs into {id, name, role} so chips can render names.
        # N+1 across the comments list — acceptable for typical thread sizes;
        # optimize via a context-level prefetch only if it shows up in profiling.
        ids = obj.mentions_ids
        if not ids:
            return []
        from apps.core.models import User
        users = User.objects.filter(id__in=ids).only('id', 'username', 'first_name', 'last_name', 'role')
        return [
            {
                'id': u.id,
                'name': (' '.join(p for p in [u.first_name, u.last_name] if p).strip() or u.username),
                'role': u.role,
            }
            for u in users
        ]

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

    def get_allowed_transitions(self, obj: Shipment) -> list[str]:
        if obj.status is None:
            return []
        current_code = obj.status.code
        return [to_code for to_code, _roles in TRANSITIONS.get(current_code, [])]

    class Meta(ShipmentListSerializer.Meta):
        # harvest_age_days and freshness are inherited from ShipmentListSerializer
        # (both the SerializerMethodField declarations and their getter methods).
        fields = ShipmentListSerializer.Meta.fields + [
            'platform_id',
            'box_count',
            'pallet_count',
            'packaging_kg',
            'vehicle_condition',
            'vehicle_condition_note',
            'route_note',
            'price_per_kg',
            'total_amount_usd',
            'loading_started_at',
            'customs_entry_at',
            'customs_exit_at',
            'border_crossed_at',
            'sale_started_at',
            'sale_ended_at',
            'notes',
            'status_code',
            'allowed_transitions',
            'variety_confidence',
            'variety_confidence_display',
            'varieties_dominant',
            'quality',
            'sales_report',
            'created_at',
            'updated_at',
            'firm_splits',
            'block_sources',
            'status_log',
            'comments',
        ]


# All fields a user could potentially PATCH on Shipment (superset of all roles).
# AD-1 timestamps are intentionally excluded — they are set ONLY by transition_to().
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
    'vehicle_condition', 'vehicle_condition_note', 'route_note',
    'vehicle_responsible', 'truck_head_id', 'trailer_id', 'driver_id',
    'transit_days', 'transport_temp_c', 'shelf_life_days',
    'has_peregruz', 'peregruz_city', 'peregruz_date',
    # Operational status
    'customs_clearance', 'documents_status', 'harvest_status',
    # Finance
    'price_per_kg', 'total_amount_usd',
    # Flags
    'is_gapy_satys',
    # Notes
    'notes',
}


class ShipmentPatchSerializer(serializers.ModelSerializer):
    """Handles PATCH /api/v1/export/shipments/{id}/

    Validates that the requesting user's role is allowed to edit each field
    they submitted. Unknown or unpermitted fields raise a 403-worthy error
    (raised in the view, not here — this serializer just strips them).

    Raises ValueError listing forbidden fields when validation fails.
    """

    official_export_code = serializers.CharField(
        max_length=30,
        required=False,
        allow_blank=True,
        allow_null=True,
        validators=[validate_official_export_code],
    )

    class Meta:
        model = Shipment
        fields = list(_ALL_PATCHABLE_FIELDS)

    def validate(self, attrs: dict) -> dict:
        role = self.context.get('role')
        if role in PRIVILEGED_ROLES:
            return attrs
        forbidden = [f for f in attrs if not can_edit_field(role, f)]
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


class ShipmentCreateSerializer(serializers.Serializer):
    """Validates the request body for POST /api/v1/export/shipments/.

    Enforces cargo_code format and uniqueness before creating a Shipment.

    Two modes:
    - is_draft=False (default): full creation at yuklenme (legacy path). country/customer
      are optional at the serializer level but the view still restricts this to privileged
      roles.
    - is_draft=True: supply-side draft. block_sources (≥1 item) is required.
      country/customer/city may be null — destination is decided during assignment.
    """

    cargo_code = serializers.CharField(max_length=20)
    official_export_code = serializers.CharField(
        max_length=30,
        required=False,
        allow_blank=True,
        allow_null=True,
        validators=[validate_official_export_code],
    )
    date = serializers.DateField()
    country = serializers.PrimaryKeyRelatedField(
        queryset=Country.objects.all(), required=False, allow_null=True
    )
    customer = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), required=False, allow_null=True
    )
    season = serializers.PrimaryKeyRelatedField(
        queryset=Season.objects.all(), required=False, allow_null=True
    )
    is_draft = serializers.BooleanField(default=False)
    block_sources = BlockSourceInputSerializer(many=True, required=False, default=list)
    notes = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate_cargo_code(self, value: str) -> str:
        """Validate format DDMM###/YY (exactly 7 digits, slash, 2 digits).

        Examples: 0201045/25, 3112001/24.
        """
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
        is_draft = attrs.get('is_draft', False)
        block_sources = attrs.get('block_sources', [])

        if is_draft and not block_sources:
            raise serializers.ValidationError(
                {'block_sources': 'At least one block source is required when creating a draft.'}
            )

        # Validate block uniqueness within the submitted list.
        if block_sources:
            block_ids = [row['block_id'].id for row in block_sources]
            if len(block_ids) != len(set(block_ids)):
                raise serializers.ValidationError(
                    {'block_sources': 'Duplicate blocks are not allowed in a single shipment.'}
                )

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
