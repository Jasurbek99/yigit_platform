"""Serializers for the quota issuance system.

QuotaIssuance → QuotaIssuanceFirmAllocation (nested, write-through).
QuotaIssuanceSerializer handles both read and update (replaces allocations).
QuotaIssuanceCreateSerializer handles create with nested allocations.
"""
import logging
from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.export.models import QuotaIssuance, QuotaIssuanceFirmAllocation, QuotaUsageRecord

logger = logging.getLogger(__name__)


class QuotaIssuanceFirmAllocationSerializer(serializers.ModelSerializer):
    """Read/write serializer for one per-firm allocation row."""

    export_firm_name = serializers.SerializerMethodField()
    used_kg = serializers.SerializerMethodField()

    class Meta:
        model = QuotaIssuanceFirmAllocation
        fields = ['id', 'export_firm', 'export_firm_name', 'kg_quota', 'used_kg']

    def get_export_firm_name(self, obj: QuotaIssuanceFirmAllocation) -> str:
        firm = obj.export_firm
        return getattr(firm, 'name_en', None) or getattr(firm, 'name_tk', None) or str(firm.id)

    def get_used_kg(self, obj: QuotaIssuanceFirmAllocation) -> Decimal:
        usage_map = self.context.get('usage_map', {})
        return usage_map.get(obj.id, Decimal('0'))


# ---------------------------------------------------------------------------
# Read serializer (GET list/detail)
# ---------------------------------------------------------------------------

class QuotaIssuanceSerializer(serializers.ModelSerializer):
    """Full read + update serializer for QuotaIssuance.

    On update (PUT): accepts `allocations` list — deletes existing rows and
    bulk-creates replacements inside a single transaction.
    Auto-computes matched_week / matched_year from issue_date when not manually
    reassigned.
    """

    allocations = QuotaIssuanceFirmAllocationSerializer(many=True, required=False)
    total_kg = serializers.SerializerMethodField()

    class Meta:
        model = QuotaIssuance
        fields = [
            'id',
            'issue_date',
            'product_type',
            'validity',
            'matched_week',
            'matched_year',
            'is_manually_reassigned',
            'notes',
            'created_at',
            'total_kg',
            'allocations',
        ]
        read_only_fields = ['id', 'created_at', 'total_kg']

    def get_total_kg(self, obj: QuotaIssuance) -> Decimal:
        return obj.total_kg

    def _replace_allocations(
        self, issuance: QuotaIssuance, allocations_data: list[dict]
    ) -> None:
        """Delete existing allocations and bulk-create new ones."""
        issuance.allocations.all().delete()
        rows = [
            QuotaIssuanceFirmAllocation(
                issuance=issuance,
                export_firm_id=item['export_firm'].id,
                kg_quota=item['kg_quota'],
            )
            for item in allocations_data
        ]
        QuotaIssuanceFirmAllocation.objects.bulk_create(rows, batch_size=500)

    def update(self, instance: QuotaIssuance, validated_data: dict) -> QuotaIssuance:
        allocations_data = validated_data.pop('allocations', None)

        # Auto-recompute week if not manually reassigned
        if not validated_data.get('is_manually_reassigned', instance.is_manually_reassigned):
            issue_date = validated_data.get('issue_date', instance.issue_date)
            if issue_date:
                iso = issue_date.isocalendar()
                validated_data['matched_week'] = iso[1]
                validated_data['matched_year'] = iso[0]

        with transaction.atomic():
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            instance.save()

            if allocations_data is not None:
                self._replace_allocations(instance, allocations_data)

        return instance


# ---------------------------------------------------------------------------
# Write serializer (POST create)
# ---------------------------------------------------------------------------

class _AllocationInputSerializer(serializers.Serializer):
    """Lightweight input for one allocation row when creating an issuance."""

    export_firm = serializers.IntegerField()
    kg_quota = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0.01'))


class QuotaIssuanceCreateSerializer(serializers.ModelSerializer):
    """Writable serializer for creating a new QuotaIssuance with allocations.

    Accepts:
        issue_date, product_type, notes,
        allocations: [{export_firm: <int>, kg_quota: <decimal>}, ...]

    Responds with QuotaIssuanceSerializer (full read shape).
    """

    allocations = _AllocationInputSerializer(many=True, required=False, default=list)

    class Meta:
        model = QuotaIssuance
        fields = ['issue_date', 'product_type', 'validity', 'notes', 'allocations']

    def create(self, validated_data: dict) -> QuotaIssuance:
        allocations_data = validated_data.pop('allocations', [])

        # matched_week / matched_year are auto-computed by model.save()
        with transaction.atomic():
            issuance = QuotaIssuance.objects.create(**validated_data)

            rows = [
                QuotaIssuanceFirmAllocation(
                    issuance=issuance,
                    export_firm_id=item['export_firm'],
                    kg_quota=item['kg_quota'],
                )
                for item in allocations_data
            ]
            if rows:
                QuotaIssuanceFirmAllocation.objects.bulk_create(rows, batch_size=500)

        return issuance

    def to_representation(self, instance: QuotaIssuance) -> dict:
        """Return full read shape after create."""
        return QuotaIssuanceSerializer(instance, context=self.context).data


# ---------------------------------------------------------------------------
# Quota usage record serializer
# ---------------------------------------------------------------------------

class QuotaUsageRecordSerializer(serializers.ModelSerializer):
    """Read/write serializer for QuotaUsageRecord."""

    export_firm_name = serializers.SerializerMethodField()
    cargo_code = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = QuotaUsageRecord
        fields = [
            'id', 'usage_date', 'export_firm', 'export_firm_name',
            'kg_used', 'product_type', 'status', 'notes',
            'shipment', 'cargo_code',
            'approved_by', 'approved_by_name', 'approved_at',
            'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = [
            'id', 'status', 'approved_by', 'approved_by_name', 'approved_at',
            'created_by', 'created_by_name', 'created_at', 'cargo_code',
        ]

    def get_export_firm_name(self, obj: QuotaUsageRecord) -> str:
        firm = obj.export_firm
        return getattr(firm, 'name_en', None) or getattr(firm, 'name_tk', None) or str(firm.id)

    def get_cargo_code(self, obj: QuotaUsageRecord) -> str | None:
        if obj.shipment_id:
            return getattr(obj.shipment, 'cargo_code', None)
        return None

    def get_approved_by_name(self, obj: QuotaUsageRecord) -> str | None:
        if obj.approved_by_id:
            u = obj.approved_by
            return f'{u.first_name} {u.last_name}'.strip() or u.username
        return None

    def get_created_by_name(self, obj: QuotaUsageRecord) -> str | None:
        if obj.created_by_id:
            u = obj.created_by
            return f'{u.first_name} {u.last_name}'.strip() or u.username
        return None
