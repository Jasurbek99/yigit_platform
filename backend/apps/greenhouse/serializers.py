from decimal import Decimal

from rest_framework import serializers

from apps.greenhouse.models import BlockManagerAssignment, DomesticSale, WeeklyHarvestPlan


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
