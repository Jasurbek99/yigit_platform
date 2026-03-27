from rest_framework import serializers
from apps.export.models import (
    Shipment,
    ShipmentStatusLog,
    ShipmentFirmSplit,
    ShipmentBlockSource,
    ShipmentComment,
)


class ShipmentListSerializer(serializers.ModelSerializer):
    """Lightweight list serializer — no nested objects.

    Used by the ProTable list view. Matches api-contract.md list shape.
    """

    # DB column is status_id (FK); expose both ID and display name per api-contract
    status_display = serializers.CharField(source='status.name_en', read_only=True)
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
            'country_name',
            'customer_name',
            'weight_net',
            'weight_gross',
            'departed_at',
            'arrived_at',
            'is_gapy_satys',
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
            'created_at',
            'updated_at',
            'firm_splits',
            'block_sources',
            'status_log',
            'comments',
        ]
