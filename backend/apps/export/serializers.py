import re
from decimal import Decimal

from rest_framework import serializers

from apps.core.models import Country, Customer, Season
from apps.core.permissions import can_edit_field, PRIVILEGED_ROLES
from apps.export.services import TRANSITIONS
from apps.export.models import (
    FinansistAdvance,
    FinansistAdvanceShipment,
    QualityDocument,
    SalesReport,
    Shipment,
    ShipmentStatusLog,
    ShipmentFirmSplit,
    ShipmentBlockSource,
    ShipmentComment,
)


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

    class Meta:
        model = Shipment
        fields = [
            'id',
            'cargo_code',
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

    # Product — TomatoVariety has no 'code' field; type is the closest equivalent
    variety_name = serializers.CharField(source='variety.name', read_only=True, default=None)
    variety_code = serializers.CharField(source='variety.type', read_only=True, default=None)

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

    # Inline related data
    firm_splits = SheetFirmSplitInlineSerializer(many=True, read_only=True)
    block_sources = SheetBlockSourceInlineSerializer(many=True, read_only=True)

    class Meta:
        model = Shipment
        fields = [
            # Identifiers
            'id', 'cargo_code', 'date',
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
            'variety', 'variety_name', 'variety_code',
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
    user_name = serializers.CharField(source='user.username', read_only=True)
    role = serializers.CharField(source='user.role', read_only=True)

    class Meta:
        model = ShipmentComment
        fields = ['id', 'user_name', 'role', 'content', 'is_system', 'created_at']


class ShipmentDetailSerializer(ShipmentListSerializer):
    """Full detail serializer with all nested related objects.

    Used on GET /api/v1/export/shipments/{id}/ and returned by transition endpoint.
    """

    firm_splits = FirmSplitSerializer(many=True, read_only=True)
    block_sources = BlockSourceSerializer(many=True, read_only=True)
    status_log = StatusLogSerializer(many=True, read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    quality = QualityDocumentSerializer(read_only=True)
    sales_report = SalesReportSerializer(read_only=True)
    status_code = serializers.CharField(source='status.code', read_only=True)
    allowed_transitions = serializers.SerializerMethodField()

    def get_allowed_transitions(self, obj: Shipment) -> list[str]:
        if obj.status is None:
            return []
        current_code = obj.status.code
        return [to_code for to_code, _roles in TRANSITIONS.get(current_code, [])]

    class Meta(ShipmentListSerializer.Meta):
        fields = ShipmentListSerializer.Meta.fields + [
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
            'quality',
            'sales_report',
            'created_at',
            'updated_at',
            'firm_splits',
            'block_sources',
            'status_log',
            'comments',
        ]


# All fields a user could potentially PATCH on Shipment (superset of all roles)
_ALL_PATCHABLE_FIELDS = {
    # Weight / packaging
    'box_count', 'pallet_count', 'weight_net', 'weight_gross', 'packaging_kg',
    'rejected_weight_kg',
    # Vehicle / transport
    'vehicle_condition', 'vehicle_condition_note', 'route_note',
    'vehicle_responsible', 'has_peregruz', 'peregruz_city', 'peregruz_date',
    'transport_temp_c', 'transit_days',
    # Finance
    'price_per_kg', 'total_amount_usd',
    # Geography / customer
    'country', 'city', 'customer', 'import_firm', 'border_point',
    # Product
    'variety',
    # Timestamps (AD-1 fields written by transition_to, but sheet may need direct edit)
    'loading_started_at', 'customs_entry_at', 'customs_exit_at',
    'departed_at', 'border_crossed_at', 'arrived_at',
    'sale_started_at', 'sale_ended_at',
    # Operational status
    'customs_clearance', 'documents_status', 'harvest_status',
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


class ShipmentCreateSerializer(serializers.Serializer):
    """Validates the request body for POST /api/v1/export/shipments/.

    Enforces cargo_code format and uniqueness before creating a Shipment.
    """

    cargo_code = serializers.CharField(max_length=20)
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
