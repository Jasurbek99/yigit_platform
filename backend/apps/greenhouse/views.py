import logging

from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import write_permission
from apps.core.roles import DOMESTIC_WRITE, HARVEST_DAY_WRITE, HARVEST_DAY_OVERRIDE
from apps.greenhouse.models import (
    BlockManagerAssignment,
    DomesticSale,
    HarvestDayEntry,
    WeeklyHarvestPlan,
)
from apps.greenhouse.serializers import (
    DomesticSaleSerializer,
    HarvestDayEntrySerializer,
    WeeklyHarvestPlanSerializer,
)
from apps.greenhouse.services import (
    admin_override,
    get_block_summary,
    initialize_harvest_week,
    set_actual_value,
    set_forecast_value,
    set_plan_value,
)

logger = logging.getLogger(__name__)

_DOMESTIC_WRITE_ROLES = DOMESTIC_WRITE


class WeeklyHarvestPlanViewSet(ModelViewSet):
    """
    GET    /api/v1/greenhouse/harvest-plans/            — list (filter by ?season=&block=&year=&week=)
    GET    /api/v1/greenhouse/harvest-plans/{id}/       — detail
    POST   /api/v1/greenhouse/harvest-plans/            — create (admin / greenhouse_manager for own blocks)
    PATCH  /api/v1/greenhouse/harvest-plans/{id}/       — partial update

    Per-block authorization:
      - admin: always allowed for any block.
      - greenhouse_manager: must have an active BlockManagerAssignment for the target block.
      - All other roles: denied on write.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = WeeklyHarvestPlanSerializer
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']

    queryset = WeeklyHarvestPlan.objects.select_related(
        'season', 'block', 'entered_by',
    ).order_by('year', 'week_number', 'block__code')

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if season := params.get('season'):
            qs = qs.filter(season_id=season)
        if block := params.get('block'):
            qs = qs.filter(block_id=block)
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if week := params.get('week'):
            qs = qs.filter(week_number=week)
        return qs

    def _check_plan_permission(self, user, block_id: int, *, is_create: bool) -> None:
        """Raise PermissionDenied if the user may not write the given block's plan."""
        role = getattr(user, 'role', None)

        if role == 'admin':
            return

        if role == 'greenhouse_manager':
            has_assignment = BlockManagerAssignment.objects.filter(
                user=user,
                block_id=block_id,
                is_active=True,
            ).exists()
            if not has_assignment:
                raise PermissionDenied(
                    f"greenhouse_manager is not assigned to block {block_id}."
                )
            return

        raise PermissionDenied(
            f"Role '{role}' is not allowed to write harvest plans."
        )

    def perform_create(self, serializer):
        block_id = serializer.validated_data['block'].id
        self._check_plan_permission(self.request.user, block_id, is_create=True)
        serializer.save(entered_by=self.request.user)

    def perform_update(self, serializer):
        instance = serializer.instance
        block_id = instance.block_id
        self._check_plan_permission(self.request.user, block_id, is_create=False)
        serializer.save(entered_by=self.request.user)

    # --- Workflow actions ---

    @action(detail=False, methods=['post'], url_path='initialize-week')
    def initialize_week(self, request):
        """Create draft WeeklyHarvestPlan rows for all active blocks."""
        season_id = request.data.get('season')
        week_number = request.data.get('week_number')
        year = request.data.get('year')

        if not all([season_id, week_number, year]):
            return Response(
                {'error': 'season, week_number, and year are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        role = getattr(request.user, 'role', None)
        if role not in ('admin', 'director'):
            raise PermissionDenied('Only admin or director can initialize a week plan.')

        plans = initialize_harvest_week(season_id, week_number, year, request.user)
        serializer = self.get_serializer(plans, many=True)
        return Response({'count': len(serializer.data), 'results': serializer.data})

    @action(detail=False, methods=['get'], url_path='block-summary')
    def block_summary(self, request):
        """GET /api/v1/greenhouse/harvest-plans/block-summary/?season=&year=&week="""
        params = request.query_params
        if not params.get('year') or not params.get('week'):
            return Response(
                {'error': 'year and week query params are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        results = get_block_summary(
            year=int(params['year']),
            week=int(params['week']),
            season_id=params.get('season'),
        )
        return Response(results)


class HarvestDayEntryViewSet(ModelViewSet):
    """
    GET    /api/v1/greenhouse/day-entries/              — list (filter ?season=&block=&date_from=&date_to=&weekly_plan=)
    GET    /api/v1/greenhouse/day-entries/{id}/         — detail
    PATCH  /api/v1/greenhouse/day-entries/{id}/         — update plan/forecast/actual values

    PATCH body dispatches per field present in the payload:
      - `plan_value`     → set_plan_value(entry, value, user, reason)
      - `forecast_value` → set_forecast_value(entry, value, user, reason)
      - `actual_value`   → set_actual_value(entry, value, user, reason)
    `reason` is required when an admin is overriding.

    POST and DELETE are disabled — rows are created by initialize_harvest_week.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = HarvestDayEntrySerializer
    http_method_names = ['get', 'patch', 'head', 'options']

    queryset = HarvestDayEntry.objects.select_related(
        'block', 'season', 'weekly_plan',
        'plan_submitted_by', 'forecast_submitted_by', 'last_override_by',
    ).order_by('entry_date', 'block__code')

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if season := params.get('season'):
            qs = qs.filter(season_id=season)
        if block := params.get('block'):
            qs = qs.filter(block_id=block)
        if date_from := params.get('date_from'):
            qs = qs.filter(entry_date__gte=date_from)
        if date_to := params.get('date_to'):
            qs = qs.filter(entry_date__lte=date_to)
        if weekly_plan := params.get('weekly_plan'):
            qs = qs.filter(weekly_plan_id=weekly_plan)
        return qs

    def partial_update(self, request, *args, **kwargs):
        """PATCH — dispatch plan/forecast/actual writes to the appropriate service functions."""
        entry = self.get_object()
        data = request.data
        reason = data.get('reason', '')
        errors = {}

        if 'plan_value' in data:
            try:
                set_plan_value(entry, data['plan_value'], request.user, reason)
            except (ValueError, PermissionError) as exc:
                errors['plan_value'] = str(exc)

        if 'forecast_value' in data:
            try:
                set_forecast_value(entry, data['forecast_value'], request.user, reason)
            except (ValueError, PermissionError) as exc:
                errors['forecast_value'] = str(exc)

        if 'actual_value' in data:
            try:
                set_actual_value(entry, data['actual_value'], request.user, reason)
            except (ValueError, PermissionError) as exc:
                errors['actual_value'] = str(exc)

        if not any(k in data for k in ('plan_value', 'forecast_value', 'actual_value')):
            raise ValidationError(
                'PATCH body must include at least one of: plan_value, forecast_value, actual_value.'
            )

        if errors:
            return Response(errors, status=http_status.HTTP_400_BAD_REQUEST)

        # Re-fetch from DB to return updated state
        entry.refresh_from_db()
        return Response(self.get_serializer(entry).data)

    @action(detail=True, methods=['get'], url_path='history')
    def history(self, request, pk=None):
        """GET /api/v1/greenhouse/day-entries/{id}/history/

        Returns AuditLog entries for this HarvestDayEntry, newest first.
        """
        from apps.export.models import AuditLog

        instance = self.get_object()
        logs = AuditLog.objects.filter(
            model_name='HarvestDayEntry',
            object_id=str(instance.id),
        ).order_by('-created_at').values(
            'id', 'action', 'field_name', 'old_value', 'new_value',
            'detail', 'user_id', 'created_at',
        )
        return Response(list(logs))


class DomesticSaleViewSet(ModelViewSet):
    """
    GET    /api/v1/greenhouse/domestic-sales/        — list (filter ?block=&buyer=&export_firm=&date_from=&date_to=)
    POST   /api/v1/greenhouse/domestic-sales/        — create
    PATCH  /api/v1/greenhouse/domestic-sales/{id}/   — partial update
    """

    permission_classes = [IsAuthenticated, write_permission(*_DOMESTIC_WRITE_ROLES)]
    serializer_class = DomesticSaleSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']
    filterset_fields = ['block', 'buyer', 'export_firm']
    search_fields = ['tabel_no', 'variety']

    queryset = DomesticSale.objects.select_related(
        'buyer', 'block', 'export_firm', 'created_by'
    ).order_by('-date', '-id')

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if date_from := params.get('date_from'):
            qs = qs.filter(date__gte=date_from)
        if date_to := params.get('date_to'):
            qs = qs.filter(date__lte=date_to)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
