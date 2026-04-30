from rest_framework import serializers

from apps.greenhouse.models import BlockManagerAssignment, DomesticSale, HarvestDayEntry, WeeklyHarvestPlan


class WeeklyHarvestPlanSerializer(serializers.ModelSerializer):
    block_code = serializers.CharField(source='block.code', read_only=True)
    block_name = serializers.CharField(source='block.name', read_only=True)
    season_name = serializers.CharField(source='season.name', read_only=True)
    entered_by_name = serializers.CharField(source='entered_by.username', read_only=True)
    submitted_by_name = serializers.CharField(source='submitted_by.username', read_only=True, default=None)

    class Meta:
        model = WeeklyHarvestPlan
        fields = [
            'id', 'season', 'season_name', 'block', 'block_code', 'block_name',
            'week_number', 'year',
            'submitted_at', 'submitted_by', 'submitted_by_name',
            'locked_at',
            'entered_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'block_code', 'block_name', 'season_name',
            'entered_by_name', 'submitted_by_name',
            'submitted_at', 'submitted_by',
            'locked_at', 'created_at', 'updated_at',
        ]


class HarvestDayEntrySerializer(serializers.ModelSerializer):
    block_code = serializers.CharField(source='block.code', read_only=True)
    block_name = serializers.CharField(source='block.name', read_only=True)
    plan_submitted_by_name = serializers.CharField(
        source='plan_submitted_by.username', read_only=True, default=None,
    )
    forecast_submitted_by_name = serializers.CharField(
        source='forecast_submitted_by.username', read_only=True, default=None,
    )
    last_override_by_name = serializers.CharField(
        source='last_override_by.username', read_only=True, default=None,
    )

    class Meta:
        model = HarvestDayEntry
        fields = [
            'id', 'weekly_plan', 'season', 'block', 'block_code', 'block_name',
            'entry_date', 'weekday',
            'plan_value', 'plan_submitted_at', 'plan_submitted_by', 'plan_submitted_by_name', 'plan_state',
            'forecast_value', 'forecast_submitted_at', 'forecast_submitted_by',
            'forecast_submitted_by_name', 'forecast_window', 'forecast_revision_count',
            'actual_value', 'actual_finalized_at', 'actual_source',
            'last_override_at', 'last_override_by', 'last_override_by_name', 'last_override_reason',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'block_code', 'block_name',
            'plan_submitted_at', 'plan_submitted_by', 'plan_submitted_by_name', 'plan_state',
            'forecast_submitted_at', 'forecast_submitted_by', 'forecast_submitted_by_name',
            'forecast_window', 'forecast_revision_count',
            'actual_finalized_at', 'actual_source',
            'last_override_at', 'last_override_by', 'last_override_by_name', 'last_override_reason',
            'created_at', 'updated_at',
        ]


class DomesticSaleSerializer(serializers.ModelSerializer):
    """Serializer for domestic (within-TM) tomato sale records."""

    buyer_name = serializers.CharField(source='buyer.name', read_only=True)
    block_code = serializers.CharField(source='block.code', read_only=True)
    block_name = serializers.CharField(source='block.name', read_only=True)
    export_firm_name = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    def get_export_firm_name(self, obj: DomesticSale) -> str | None:
        if not obj.export_firm_id:
            return None
        firm = obj.export_firm
        return firm.name_en or firm.name_tk

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


class BlockManagerAssignmentSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.username', read_only=True)
    block_code = serializers.CharField(source='block.code', read_only=True)
    block_name = serializers.CharField(source='block.name', read_only=True)

    class Meta:
        model = BlockManagerAssignment
        fields = ['id', 'user', 'user_name', 'block', 'block_code', 'block_name', 'is_active', 'created_at']
        read_only_fields = ['user_name', 'block_code', 'block_name', 'created_at']
