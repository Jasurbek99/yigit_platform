import logging
from decimal import Decimal

from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import write_permission
from apps.core.roles import DOMESTIC_WRITE, PLAN_WRITE
from apps.greenhouse.models import BlockManagerAssignment, DomesticSale, WeeklyHarvestPlan
from apps.greenhouse.serializers import DomesticSaleSerializer, WeeklyHarvestPlanSerializer
from apps.greenhouse.services import (
    approve_harvest_plan,
    get_block_summary,
    initialize_harvest_week,
    reject_harvest_plan,
    submit_harvest_plan,
)

logger = logging.getLogger(__name__)

_PLAN_WRITE_ROLES = PLAN_WRITE
_DOMESTIC_WRITE_ROLES = DOMESTIC_WRITE


class WeeklyHarvestPlanViewSet(ModelViewSet):
    """
    GET    /api/v1/greenhouse/harvest-plans/            — list (filter by ?season=&block=&year=&week=)
    GET    /api/v1/greenhouse/harvest-plans/{id}/       — detail
    POST   /api/v1/greenhouse/harvest-plans/            — create (greenhouse_manager / export_manager / director)
    PUT    /api/v1/greenhouse/harvest-plans/{id}/       — update plan values

    Per-block authorization:
      - director / export_manager: always allowed for any block.
      - greenhouse_manager: must have an active BlockManagerAssignment for the target block.
      - All other roles: denied on write.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = WeeklyHarvestPlanSerializer
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']

    queryset = WeeklyHarvestPlan.objects.select_related(
        'season', 'block', 'entered_by',
        'submitted_by', 'approved_by', 'rejected_by',
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

        if role in ('director', 'export_manager'):
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

    # Day field name sets for status-based validation.
    _PLAN_FIELDS = frozenset(f'{d}_plan_kg' for d in
                             ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'))
    _ACTUAL_FIELDS = frozenset(f'{d}_actual_kg' for d in
                               ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'))

    def perform_update(self, serializer):
        """Status-based field locking on update.

        - draft / rejected: only plan_kg fields may change.
        - approved: only actual_kg fields may change (and only for today or past days).
        - submitted: no edits allowed (locked pending review).
        """
        instance = serializer.instance
        block_id = instance.block_id
        self._check_plan_permission(self.request.user, block_id, is_create=False)

        changed_fields = set(serializer.validated_data.keys())

        if instance.status == 'submitted':
            raise ValidationError('Plan is pending approval and cannot be edited.')

        if instance.status in ('draft', 'rejected'):
            disallowed = changed_fields & self._ACTUAL_FIELDS
            if disallowed:
                raise ValidationError(
                    f'Cannot edit actual fields while plan is in {instance.status} status.'
                )

        if instance.status == 'approved':
            disallowed = changed_fields & self._PLAN_FIELDS
            if disallowed:
                raise ValidationError(
                    'Cannot edit plan fields after approval. Only actual kg can be updated.'
                )
            today = timezone.now().date()
            today_weekday = today.isoweekday()
            day_index = {
                'monday': 1, 'tuesday': 2, 'wednesday': 3,
                'thursday': 4, 'friday': 5, 'saturday': 6,
            }
            for field_name in changed_fields & self._ACTUAL_FIELDS:
                day_name = field_name.replace('_actual_kg', '')
                if day_index[day_name] > today_weekday:
                    raise ValidationError(
                        f'Cannot enter actual for {day_name} — it is a future day.'
                    )

        serializer.save(entered_by=self.request.user)

    # --- Workflow actions ---

    @action(detail=True, methods=['post'], url_path='submit')
    def submit(self, request, pk=None):
        plan = self.get_object()
        try:
            submit_harvest_plan(plan, request.user)
        except (ValueError, PermissionError) as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(plan).data)

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        plan = self.get_object()
        try:
            approve_harvest_plan(plan, request.user)
        except (ValueError, PermissionError) as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(plan).data)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        plan = self.get_object()
        rejection_note = request.data.get('rejection_note', '')
        try:
            reject_harvest_plan(plan, request.user, rejection_note)
        except (ValueError, PermissionError) as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(plan).data)

    @action(detail=False, methods=['post'], url_path='bulk-submit')
    def bulk_submit(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'error': 'ids list is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        plans = WeeklyHarvestPlan.objects.filter(
            id__in=ids, status__in=['draft', 'rejected'],
        ).select_related('block')
        submitted_ids = []
        errors = []
        for plan in plans:
            try:
                submit_harvest_plan(plan, request.user)
                submitted_ids.append(plan.id)
            except (ValueError, PermissionError) as exc:
                errors.append({'id': plan.id, 'error': str(exc)})

        return Response({'submitted': submitted_ids, 'errors': errors})

    @action(detail=False, methods=['post'], url_path='bulk-approve')
    def bulk_approve(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'error': 'ids list is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        plans = WeeklyHarvestPlan.objects.filter(
            id__in=ids, status='submitted',
        ).select_related('block')
        approved_ids = []
        errors = []
        for plan in plans:
            try:
                approve_harvest_plan(plan, request.user)
                approved_ids.append(plan.id)
            except (ValueError, PermissionError) as exc:
                errors.append({'id': plan.id, 'error': str(exc)})

        return Response({'approved': approved_ids, 'errors': errors})

    @action(detail=False, methods=['post'], url_path='bulk-reject')
    def bulk_reject(self, request):
        ids = request.data.get('ids', [])
        rejection_note = request.data.get('rejection_note', '')
        if not ids:
            return Response({'error': 'ids list is required.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if not rejection_note or not rejection_note.strip():
            return Response({'error': 'rejection_note is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        plans = WeeklyHarvestPlan.objects.filter(
            id__in=ids, status='submitted',
        ).select_related('block')
        rejected_ids = []
        errors = []
        for plan in plans:
            try:
                reject_harvest_plan(plan, request.user, rejection_note)
                rejected_ids.append(plan.id)
            except (ValueError, PermissionError) as exc:
                errors.append({'id': plan.id, 'error': str(exc)})

        return Response({'rejected': rejected_ids, 'errors': errors})

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
        if role not in ('director', 'export_manager'):
            raise PermissionDenied('Only director or export_manager can initialize a week plan.')

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
