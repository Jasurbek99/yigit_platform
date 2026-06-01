import logging

from django.db import transaction
from django.utils import timezone
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

    @action(detail=True, methods=['post'], url_path='grant-late-edit')
    def grant_late_edit(self, request, pk=None):
        """POST /api/v1/greenhouse/harvest-plans/{id}/grant-late-edit/

        Grant a greenhouse_manager a time-limited extension to edit plan values
        after the Sunday-EOD cutoff.

        Body:
            granted_until (ISO 8601 datetime with tz, required): expiry of the extension.
            reason (string, optional): justification for the extension (stored as-is).

        Permission: admin only.
        """
        role = getattr(request.user, 'role', None)
        if role != 'admin':
            raise PermissionDenied('Only admin can grant a late-edit extension.')

        plan = self.get_object()
        granted_until_raw = request.data.get('granted_until')
        reason = request.data.get('reason', '').strip()

        errors = {}

        if not granted_until_raw:
            errors['granted_until'] = 'This field is required.'
        else:
            # Parse the datetime value; DRF DateTimeField handles ISO 8601 + tz.
            from rest_framework.fields import DateTimeField as DRFDateTimeField
            dt_field = DRFDateTimeField()
            try:
                granted_until = dt_field.run_validation(granted_until_raw)
            except Exception:
                errors['granted_until'] = 'Enter a valid ISO 8601 datetime with timezone.'
            else:
                now = timezone.now()
                if granted_until <= now:
                    errors['granted_until'] = (
                        'granted_until must be in the future.'
                    )

        if errors:
            return Response(errors, status=http_status.HTTP_400_BAD_REQUEST)

        plan.late_edit_granted_until = granted_until
        plan.late_edit_granted_by = request.user
        plan.late_edit_granted_at = timezone.now()
        plan.late_edit_granted_reason = reason
        plan.save(update_fields=[
            'late_edit_granted_until',
            'late_edit_granted_by',
            'late_edit_granted_at',
            'late_edit_granted_reason',
            'updated_at',
        ])

        logger.info(
            'WeeklyHarvestPlan %d late-edit extension granted by %s until %s',
            plan.id, request.user.username, granted_until,
        )
        serializer = self.get_serializer(plan)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='revoke-late-edit')
    def revoke_late_edit(self, request, pk=None):
        """POST /api/v1/greenhouse/harvest-plans/{id}/revoke-late-edit/

        Revoke a previously granted late-edit extension, clearing all four
        late_edit_* fields back to null/empty.

        Permission: admin only.
        """
        role = getattr(request.user, 'role', None)
        if role != 'admin':
            raise PermissionDenied('Only admin can revoke a late-edit extension.')

        plan = self.get_object()
        plan.late_edit_granted_until = None
        plan.late_edit_granted_by = None
        plan.late_edit_granted_at = None
        plan.late_edit_granted_reason = ''
        plan.save(update_fields=[
            'late_edit_granted_until',
            'late_edit_granted_by',
            'late_edit_granted_at',
            'late_edit_granted_reason',
            'updated_at',
        ])

        logger.info(
            'WeeklyHarvestPlan %d late-edit extension revoked by %s',
            plan.id, request.user.username,
        )
        serializer = self.get_serializer(plan)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='bulk-grant-late-edit')
    def bulk_grant_late_edit(self, request):
        """POST /api/v1/greenhouse/harvest-plans/bulk-grant-late-edit/

        Grant a late-edit extension on multiple WeeklyHarvestPlan rows at once.

        Body:
            plan_ids (list[int], required, non-empty): IDs of plans to update.
            granted_until (ISO 8601 datetime with tz, required): must be in the future.
            reason (string, optional): applied uniformly to all listed rows.

        Unknown IDs are silently skipped. Response reflects only rows that matched.

        Permission: admin only.
        """
        role = getattr(request.user, 'role', None)
        if role != 'admin':
            raise PermissionDenied('Only admin can bulk-grant late-edit extensions.')

        plan_ids = request.data.get('plan_ids')
        granted_until_raw = request.data.get('granted_until')
        reason = request.data.get('reason', '').strip()

        errors = {}

        if not isinstance(plan_ids, list) or len(plan_ids) == 0:
            errors['plan_ids'] = 'A non-empty list of integer plan IDs is required.'

        if not granted_until_raw:
            errors['granted_until'] = 'This field is required.'
        else:
            from rest_framework.fields import DateTimeField as DRFDateTimeField
            dt_field = DRFDateTimeField()
            try:
                granted_until = dt_field.run_validation(granted_until_raw)
            except Exception:
                errors['granted_until'] = 'Enter a valid ISO 8601 datetime with timezone.'
            else:
                if granted_until <= timezone.now():
                    errors['granted_until'] = 'granted_until must be in the future.'

        if errors:
            return Response(errors, status=http_status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        with transaction.atomic():
            plans = list(WeeklyHarvestPlan.objects.filter(id__in=plan_ids).select_related(
                'season', 'block', 'entered_by',
            ))
            for plan in plans:
                plan.late_edit_granted_until = granted_until
                plan.late_edit_granted_by = request.user
                plan.late_edit_granted_at = now
                plan.late_edit_granted_reason = reason
                plan.updated_at = now

            WeeklyHarvestPlan.objects.bulk_update(
                plans,
                [
                    'late_edit_granted_until', 'late_edit_granted_by',
                    'late_edit_granted_at', 'late_edit_granted_reason', 'updated_at',
                ],
                batch_size=500,
            )

        count = len(plans)
        logger.info(
            'Bulk late-edit extension granted on %d plans by %s until %s',
            count, request.user.username, granted_until,
        )
        serializer = self.get_serializer(plans, many=True)
        return Response({'updated': count, 'results': serializer.data})

    @action(detail=False, methods=['post'], url_path='bulk-revoke-late-edit')
    def bulk_revoke_late_edit(self, request):
        """POST /api/v1/greenhouse/harvest-plans/bulk-revoke-late-edit/

        Revoke late-edit extensions on multiple WeeklyHarvestPlan rows at once,
        clearing all four late_edit_* fields back to null/empty.

        Body:
            plan_ids (list[int], required, non-empty): IDs of plans to update.

        Unknown IDs are silently skipped. Response reflects only rows that matched.

        Permission: admin only.
        """
        role = getattr(request.user, 'role', None)
        if role != 'admin':
            raise PermissionDenied('Only admin can bulk-revoke late-edit extensions.')

        plan_ids = request.data.get('plan_ids')

        if not isinstance(plan_ids, list) or len(plan_ids) == 0:
            return Response(
                {'plan_ids': 'A non-empty list of integer plan IDs is required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        with transaction.atomic():
            plans = list(WeeklyHarvestPlan.objects.filter(id__in=plan_ids).select_related(
                'season', 'block', 'entered_by',
            ))
            for plan in plans:
                plan.late_edit_granted_until = None
                plan.late_edit_granted_by = None
                plan.late_edit_granted_at = None
                plan.late_edit_granted_reason = ''
                plan.updated_at = now

            WeeklyHarvestPlan.objects.bulk_update(
                plans,
                [
                    'late_edit_granted_until', 'late_edit_granted_by',
                    'late_edit_granted_at', 'late_edit_granted_reason', 'updated_at',
                ],
                batch_size=500,
            )

        count = len(plans)
        logger.info(
            'Bulk late-edit extensions revoked on %d plans by %s',
            count, request.user.username,
        )
        serializer = self.get_serializer(plans, many=True)
        return Response({'updated': count, 'results': serializer.data})


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
