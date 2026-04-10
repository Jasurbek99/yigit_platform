from decimal import Decimal

from rest_framework import serializers
from apps.export.models import WeeklyHarvestPlan, WeeklyLocalSellPlan, WeeklyTruckAllocation, TruckDestinationSplit, PriceEntry, DomesticSale


class WeeklyHarvestPlanSerializer(serializers.ModelSerializer):
    block_code = serializers.CharField(source='block.code', read_only=True)
    block_name = serializers.CharField(source='block.name', read_only=True)
    season_name = serializers.CharField(source='season.name', read_only=True)
    entered_by_name = serializers.CharField(source='entered_by.username', read_only=True)

    # Approval workflow read-only fields
    submitted_by_name = serializers.CharField(
        source='submitted_by.username', read_only=True, default=None,
    )
    approved_by_name = serializers.CharField(
        source='approved_by.username', read_only=True, default=None,
    )
    rejected_by_name = serializers.CharField(
        source='rejected_by.username', read_only=True, default=None,
    )

    # Computed totals
    total_plan_kg = serializers.SerializerMethodField()
    total_actual_kg = serializers.SerializerMethodField()

    def get_total_plan_kg(self, obj: WeeklyHarvestPlan) -> Decimal:
        fields = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        return sum(getattr(obj, f'{d}_plan_kg') for d in fields)

    def get_total_actual_kg(self, obj: WeeklyHarvestPlan) -> Decimal | None:
        fields = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        vals = [getattr(obj, f'{d}_actual_kg') for d in fields]
        if all(v is None for v in vals):
            return obj.actual_weekly_total_kg  # fallback for import-only weekly totals
        return sum(v or Decimal('0') for v in vals)

    class Meta:
        model = WeeklyHarvestPlan
        fields = [
            'id', 'season', 'season_name', 'block', 'block_code', 'block_name',
            'week_number', 'year',
            'monday_plan_kg', 'tuesday_plan_kg', 'wednesday_plan_kg',
            'thursday_plan_kg', 'friday_plan_kg', 'saturday_plan_kg',
            'monday_actual_kg', 'tuesday_actual_kg', 'wednesday_actual_kg',
            'thursday_actual_kg', 'friday_actual_kg', 'saturday_actual_kg',
            'actual_weekly_total_kg',
            'total_plan_kg', 'total_actual_kg',
            # Approval workflow
            'status', 'submitted_at', 'submitted_by_name',
            'approved_at', 'approved_by_name',
            'rejected_at', 'rejected_by_name', 'rejection_note',
            'entered_by_name', 'updated_at',
        ]
        read_only_fields = [
            'entered_by_name', 'updated_at', 'total_plan_kg', 'total_actual_kg',
            'actual_weekly_total_kg',
            'status', 'submitted_at', 'submitted_by_name',
            'approved_at', 'approved_by_name',
            'rejected_at', 'rejected_by_name', 'rejection_note',
        ]


class TruckDestinationSplitSerializer(serializers.ModelSerializer):
    destination_name = serializers.CharField(source='destination.name', read_only=True)

    class Meta:
        model = TruckDestinationSplit
        fields = ['id', 'destination', 'destination_name', 'truck_count']


class WeeklyTruckAllocationSerializer(serializers.ModelSerializer):
    """Serializer for daily truck count decisions.

    Read-only computed fields: season_name, decided_by_name.
    total_trucks_calc is computed server-side in perform_create/perform_update.
    destination_splits: nested list of truck counts per destination.
    """

    season_name = serializers.CharField(source='season.name', read_only=True)
    decided_by_name = serializers.CharField(source='decided_by.username', read_only=True)
    destination_splits = TruckDestinationSplitSerializer(many=True, read_only=True)

    class Meta:
        model = WeeklyTruckAllocation
        fields = [
            'id', 'season', 'season_name',
            'week_number', 'year', 'day_of_week',
            'total_planned_kg', 'total_trucks_calc',
            'destination_splits',
            'decided_by_name', 'created_at',
        ]
        read_only_fields = ['season_name', 'decided_by_name', 'created_at']


class DomesticSaleSerializer(serializers.ModelSerializer):
    """Serializer for domestic (within-TM) tomato sale records."""

    buyer_name = serializers.CharField(source='buyer.name', read_only=True)
    block_code = serializers.CharField(source='block.code', read_only=True)
    block_name = serializers.CharField(source='block.name', read_only=True)
    export_firm_name = serializers.SerializerMethodField()

    def get_export_firm_name(self, obj: DomesticSale) -> str | None:
        if not obj.export_firm_id:
            return None
        firm = obj.export_firm
        return firm.name_en or firm.name_tk
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = DomesticSale
        fields = [
            'id', 'date',
            'buyer', 'buyer_name',
            'block', 'block_code', 'block_name',
            'export_firm', 'export_firm_name',
            'weight_kg', 'variety', 'price_per_kg',
            'tabel_no', 'notes',
            'created_by_name', 'created_at',
        ]
        read_only_fields = ['buyer_name', 'block_code', 'block_name', 'export_firm_name', 'created_by_name', 'created_at']


class WeeklyLocalSellPlanSerializer(serializers.ModelSerializer):
    export_firm_name = serializers.SerializerMethodField()
    season_name = serializers.CharField(source='season.name', read_only=True, default=None)
    entered_by_name = serializers.CharField(source='entered_by.username', read_only=True, default=None)

    # Approval workflow read-only fields
    submitted_by_name = serializers.CharField(
        source='submitted_by.username', read_only=True, default=None,
    )
    approved_by_name = serializers.CharField(
        source='approved_by.username', read_only=True, default=None,
    )
    rejected_by_name = serializers.CharField(
        source='rejected_by.username', read_only=True, default=None,
    )

    # Computed total
    total_plan_kg = serializers.SerializerMethodField()

    def get_export_firm_name(self, obj: WeeklyLocalSellPlan) -> str | None:
        firm = obj.export_firm
        if not firm:
            return None
        return firm.name_en or firm.name_tk

    def get_total_plan_kg(self, obj: WeeklyLocalSellPlan) -> Decimal:
        fields = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        return sum(getattr(obj, f'{d}_plan_kg') for d in fields)

    class Meta:
        model = WeeklyLocalSellPlan
        fields = [
            'id', 'season', 'season_name', 'export_firm', 'export_firm_name',
            'week_number', 'year',
            'monday_plan_kg', 'tuesday_plan_kg', 'wednesday_plan_kg',
            'thursday_plan_kg', 'friday_plan_kg', 'saturday_plan_kg',
            'total_plan_kg',
            # Approval workflow
            'status', 'submitted_at', 'submitted_by_name',
            'approved_at', 'approved_by_name',
            'rejected_at', 'rejected_by_name', 'rejection_note',
            'entered_by_name', 'updated_at',
        ]
        read_only_fields = [
            'entered_by_name', 'updated_at', 'total_plan_kg',
            'status', 'submitted_at', 'submitted_by_name',
            'approved_at', 'approved_by_name',
            'rejected_at', 'rejected_by_name', 'rejection_note',
        ]


class PriceEntrySerializer(serializers.ModelSerializer):
    city_name = serializers.CharField(source='city.name', read_only=True)
    entered_by_name = serializers.CharField(source='entered_by.username', read_only=True)

    class Meta:
        model = PriceEntry
        fields = [
            'id', 'date', 'city', 'city_name',
            'price_local', 'price_usd', 'currency', 'source',
            'entered_by_name', 'created_at',
        ]
        read_only_fields = ['entered_by_name', 'created_at']
