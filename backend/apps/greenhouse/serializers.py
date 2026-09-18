from django.utils import timezone
from rest_framework import serializers

from apps.greenhouse.models import (
    BlockManagerAssignment, DomesticSale, HarvestDayEntry, PlanChangeRequest, WeeklyHarvestPlan,
)


class WeeklyHarvestPlanSerializer(serializers.ModelSerializer):
    # === Computed display fields ===
    block_code = serializers.CharField(source='block.code', read_only=True)
    block_name = serializers.CharField(source='block.name', read_only=True)
    block_manager_names = serializers.SerializerMethodField()
    season_name = serializers.CharField(source='season.name', read_only=True)
    entered_by_name = serializers.CharField(source='entered_by.username', read_only=True)

    # === Late-edit extension (read-only) ===
    late_edit_granted_by_name = serializers.SerializerMethodField()
    late_edit_active = serializers.SerializerMethodField()

    def get_block_manager_names(self, obj: WeeklyHarvestPlan) -> list[str]:
        """Return display names of the block's active managers.

        Reads the `active_manager_assignments` prefetch set by the viewset to
        stay N+1-safe; falls back to a live query if the prefetch is absent.
        """
        assignments = getattr(obj.block, 'active_manager_assignments', None)
        if assignments is None:
            assignments = obj.block.manager_assignments.filter(
                is_active=True
            ).select_related('user')
        names = []
        for assignment in assignments:
            user = assignment.user
            full_name = f'{user.first_name} {user.last_name}'.strip()
            names.append(full_name or user.username)
        return names

    def get_late_edit_granted_by_name(self, obj: WeeklyHarvestPlan) -> str | None:
        """Return the display name of the admin who granted the late-edit extension."""
        if obj.late_edit_granted_by_id is None:
            return None
        user = obj.late_edit_granted_by
        if user is None:
            return None
        full_name = f'{user.first_name} {user.last_name}'.strip()
        return full_name or user.username

    def get_late_edit_active(self, obj: WeeklyHarvestPlan) -> bool:
        """Return True if a late-edit extension is currently active (not yet expired)."""
        granted_until = obj.late_edit_granted_until
        if not granted_until:
            return False
        return granted_until > timezone.now()

    class Meta:
        model = WeeklyHarvestPlan
        fields = [
            'id', 'season', 'season_name', 'block', 'block_code', 'block_name',
            'block_manager_names',
            'week_number', 'year',
            'locked_at',
            # Late-edit extension fields
            'late_edit_granted_until', 'late_edit_granted_by', 'late_edit_granted_by_name',
            'late_edit_granted_at', 'late_edit_granted_reason',
            'late_edit_active',
            'entered_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'block_code', 'block_name', 'block_manager_names', 'season_name',
            'entered_by_name',
            'locked_at', 'created_at', 'updated_at',
            'late_edit_granted_until', 'late_edit_granted_by', 'late_edit_granted_by_name',
            'late_edit_granted_at', 'late_edit_granted_reason',
            'late_edit_active',
        ]


def _user_display(user) -> str | None:
    if user is None:
        return None
    return f'{user.first_name} {user.last_name}'.strip() or user.username


class PlanChangeBriefSerializer(serializers.ModelSerializer):
    """The pending revision embedded in a day-entry payload (ADR-024)."""

    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PlanChangeRequest
        fields = ['id', 'requested_value', 'change_pct', 'requested_by_name', 'requested_at']

    def get_requested_by_name(self, obj: PlanChangeRequest) -> str | None:
        return _user_display(obj.requested_by)


class PlanChangeRequestSerializer(serializers.ModelSerializer):
    """One row of the plan-change log / approval queue (ADR-024)."""

    block = serializers.IntegerField(source='entry.block_id', read_only=True)
    block_code = serializers.CharField(source='entry.block.code', read_only=True)
    entry_date = serializers.DateField(source='entry.entry_date', read_only=True)
    weekday = serializers.IntegerField(source='entry.weekday', read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    decided_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PlanChangeRequest
        fields = [
            'id', 'entry', 'block', 'block_code', 'entry_date', 'weekday',
            'baseline_value', 'current_value', 'requested_value', 'change_pct',
            'status', 'reason',
            'requested_by', 'requested_by_name', 'requested_at',
            'decided_by', 'decided_by_name', 'decided_at', 'decision_note',
        ]
        read_only_fields = fields

    def get_requested_by_name(self, obj: PlanChangeRequest) -> str | None:
        return _user_display(obj.requested_by)

    def get_decided_by_name(self, obj: PlanChangeRequest) -> str | None:
        return _user_display(obj.decided_by)


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
    pending_change = serializers.SerializerMethodField()

    def get_pending_change(self, obj: HarvestDayEntry) -> dict | None:
        """The cell's pending revision. Reads the viewset's `pending_changes`
        prefetch when present (list), else queries (single-object responses)."""
        pending = getattr(obj, 'pending_changes', None)
        if pending is None:
            pending = list(
                obj.change_requests.filter(status=PlanChangeRequest.STATUS_PENDING).select_related('requested_by')
            )
        return PlanChangeBriefSerializer(pending[0]).data if pending else None

    class Meta:
        model = HarvestDayEntry
        fields = [
            'id', 'weekly_plan', 'season', 'block', 'block_code', 'block_name',
            'entry_date', 'weekday',
            'plan_value', 'plan_submitted_at', 'plan_submitted_by', 'plan_submitted_by_name', 'plan_state',
            'plan_baseline_value', 'pending_change',
            'forecast_value', 'forecast_submitted_at', 'forecast_submitted_by',
            'forecast_submitted_by_name', 'forecast_window', 'forecast_revision_count',
            'actual_value', 'actual_finalized_at', 'actual_source',
            'last_override_at', 'last_override_by', 'last_override_by_name', 'last_override_reason',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'block_code', 'block_name',
            'plan_submitted_at', 'plan_submitted_by', 'plan_submitted_by_name', 'plan_state',
            'plan_baseline_value', 'pending_change',
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
