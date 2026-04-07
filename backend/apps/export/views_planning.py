import datetime
import logging
from decimal import Decimal

from django.db.models import F
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from apps.core.permissions import write_permission
from apps.export.models import (
    WeeklyHarvestPlan,
    WeeklyTruckAllocation,
    TruckDestinationSplit,
    QuotaAllocation,
    PriceEntry,
    DomesticSale,
    BlockManagerAssignment,
)
from apps.export.serializers_planning import (
    WeeklyHarvestPlanSerializer,
    WeeklyTruckAllocationSerializer,
    QuotaAllocationSerializer,
    PriceEntrySerializer,
    QuotaDashboardSerializer,
    DomesticSaleSerializer,
)
from apps.export.services import (
    submit_harvest_plan,
    approve_harvest_plan,
    reject_harvest_plan,
)

logger = logging.getLogger(__name__)

_PLAN_WRITE_ROLES = frozenset({'greenhouse_manager', 'export_manager', 'director'})
_TRUCK_WRITE_ROLES = frozenset({'export_manager', 'director'})
_DOMESTIC_WRITE_ROLES = frozenset({'warehouse_chief', 'greenhouse_manager', 'export_manager', 'director'})
_PRICE_WRITE_ROLES = frozenset({'export_manager', 'finansist', 'director'})


class WeeklyHarvestPlanViewSet(ModelViewSet):
    """
    GET    /api/v1/export/harvest-plans/            — list (filter by ?season=&block=&year=&week=)
    GET    /api/v1/export/harvest-plans/{id}/       — detail
    POST   /api/v1/export/harvest-plans/            — create (greenhouse_manager / export_manager / director)
    PUT    /api/v1/export/harvest-plans/{id}/       — update plan values

    Per-block authorization:
      - director / export_manager: always allowed for any block.
      - greenhouse_manager: must have the Django permission (add_/change_weeklyharvestplan)
        AND an active BlockManagerAssignment for the target block.
      - All other roles: denied on write.
    """

    # Role check is done inside perform_create/perform_update instead of a
    # class-level permission so we can inspect the block being written.
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
        """Raise PermissionDenied if the user may not write the given block's plan.

        Args:
            user: The requesting User instance.
            block_id: PK of the GreenhouseBlock being written.
            is_create: True for POST (create), False for PUT (update).

        Raises:
            PermissionDenied: When the user is not authorized.
        """
        role = getattr(user, 'role', None)

        # director and export_manager may write any block unconditionally.
        if role in ('director', 'export_manager'):
            return

        if role == 'greenhouse_manager':
            # Block assignment = automatic edit permission. No Django model permission needed.
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

        # All other roles are denied on write.
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
            # Only plan fields allowed.
            disallowed = changed_fields & self._ACTUAL_FIELDS
            if disallowed:
                raise ValidationError(
                    f'Cannot edit actual fields while plan is in {instance.status} status.'
                )

        if instance.status == 'approved':
            # Only actual fields allowed.
            disallowed = changed_fields & self._PLAN_FIELDS
            if disallowed:
                raise ValidationError(
                    'Cannot edit plan fields after approval. Only actual kg can be updated.'
                )
            # Validate actual entries are for today or past days within the week.
            today = timezone.now().date()
            # ISO weekday: Monday=1 .. Saturday=6
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

    # ─── Workflow actions ─────────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='submit')
    def submit(self, request, pk=None):
        """POST /api/v1/export/harvest-plans/{id}/submit/"""
        plan = self.get_object()
        try:
            submit_harvest_plan(plan, request.user)
        except (ValueError, PermissionError) as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(plan).data)

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        """POST /api/v1/export/harvest-plans/{id}/approve/"""
        plan = self.get_object()
        try:
            approve_harvest_plan(plan, request.user)
        except (ValueError, PermissionError) as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(plan).data)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        """POST /api/v1/export/harvest-plans/{id}/reject/

        Body: { "rejection_note": "..." }
        """
        plan = self.get_object()
        rejection_note = request.data.get('rejection_note', '')
        try:
            reject_harvest_plan(plan, request.user, rejection_note)
        except (ValueError, PermissionError) as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(plan).data)

    @action(detail=False, methods=['post'], url_path='bulk-submit')
    def bulk_submit(self, request):
        """POST /api/v1/export/harvest-plans/bulk-submit/

        Body: { "ids": [1, 2, 3] }
        Submits all draft/rejected plans in the given list.
        """
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
        """POST /api/v1/export/harvest-plans/bulk-approve/

        Body: { "ids": [1, 2, 3] }
        Approves all submitted plans in the given list. Skips non-submitted plans.
        """
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
        """POST /api/v1/export/harvest-plans/bulk-reject/

        Body: { "ids": [1, 2, 3], "rejection_note": "..." }
        Rejects all submitted plans in the given list.
        """
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
        """POST /api/v1/export/harvest-plans/initialize-week/

        Body: { "season": 1, "week_number": 15, "year": 2026 }
        Creates draft WeeklyHarvestPlan rows for all active blocks that don't
        already have a plan for the given (season, week, year).
        Returns the created plan rows.
        """
        from apps.core.models import GreenhouseBlock

        season_id = request.data.get('season')
        week_number = request.data.get('week_number')
        year = request.data.get('year')

        if not all([season_id, week_number, year]):
            return Response(
                {'error': 'season, week_number, and year are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        # Only directors and export_managers can initialize a week.
        role = getattr(request.user, 'role', None)
        if role not in ('director', 'export_manager'):
            raise PermissionDenied('Only director or export_manager can initialize a week plan.')

        active_blocks = GreenhouseBlock.objects.filter(is_active=True)
        existing_block_ids = set(
            WeeklyHarvestPlan.objects.filter(
                season_id=season_id, week_number=week_number, year=year,
            ).values_list('block_id', flat=True)
        )

        new_plans = [
            WeeklyHarvestPlan(
                season_id=season_id,
                block=block,
                week_number=week_number,
                year=year,
                entered_by=request.user,
            )
            for block in active_blocks
            if block.id not in existing_block_ids
        ]

        if new_plans:
            WeeklyHarvestPlan.objects.bulk_create(new_plans, batch_size=500)

        # Return all plans for this week (including any that already existed).
        qs = WeeklyHarvestPlan.objects.filter(
            season_id=season_id, week_number=week_number, year=year,
        ).select_related('season', 'block', 'entered_by', 'submitted_by', 'approved_by', 'rejected_by')
        serializer = self.get_serializer(qs, many=True)
        return Response({'count': len(serializer.data), 'results': serializer.data})

    @action(detail=False, methods=['get'], url_path='block-summary')
    def block_summary(self, request):
        """GET /api/v1/export/harvest-plans/block-summary/?season=&year=&week=

        Returns per-block aggregate totals across all 6 days.
        Does NOT filter by ?block= — always returns all blocks for the given week.
        """
        params = request.query_params
        if not params.get('year') or not params.get('week'):
            return Response(
                {'error': 'year and week query params are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        # Build queryset independently — do NOT inherit the ?block= filter from get_queryset()
        qs = WeeklyHarvestPlan.objects.select_related('block')
        if season := params.get('season'):
            qs = qs.filter(season_id=season)
        qs = qs.filter(year=params['year'], week_number=params['week'])

        DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

        block_data: dict = {}
        for plan in qs:
            bid = plan.block_id
            if bid not in block_data:
                block_data[bid] = {
                    'block_id': bid,
                    'block_code': plan.block.code,
                    'block_name': plan.block.name,
                    'total_plan_kg': Decimal('0'),
                    'total_actual_kg': None,
                    '_has_actual': False,
                }
            for d in DAYS:
                block_data[bid]['total_plan_kg'] += getattr(plan, f'{d}_plan_kg') or Decimal('0')
                actual = getattr(plan, f'{d}_actual_kg')
                if actual is not None:
                    if not block_data[bid]['_has_actual']:
                        block_data[bid]['total_actual_kg'] = Decimal('0')
                        block_data[bid]['_has_actual'] = True
                    block_data[bid]['total_actual_kg'] += actual

        results = sorted(block_data.values(), key=lambda x: x['block_code'])
        for r in results:
            r.pop('_has_actual')
            r['deficit_kg'] = (
                r['total_actual_kg'] - r['total_plan_kg']
                if r['total_actual_kg'] is not None
                else None
            )

        return Response(results)


class QuotaAllocationViewSet(ReadOnlyModelViewSet):
    """
    GET  /api/v1/export/quotas/          — list all allocations for current season
    GET  /api/v1/export/quotas/dashboard/ — summary with remaining_kg + percentage
    """

    permission_classes = [IsAuthenticated]
    serializer_class = QuotaAllocationSerializer
    queryset = QuotaAllocation.objects.select_related('season', 'export_firm').order_by(
        'export_firm__name_en'
    )

    def get_queryset(self):
        qs = super().get_queryset()
        if season := self.request.query_params.get('season'):
            qs = qs.filter(season_id=season)
        return qs

    @action(detail=False, methods=['get'], url_path='dashboard')
    def dashboard(self, request):
        """GET /api/v1/export/quotas/dashboard/

        Returns all quota allocations enriched with remaining_kg and used_pct.
        Filtered by ?season= (defaults to all).
        """
        qs = self.get_queryset().annotate(
            remaining_kg=F('granted_kg') - F('used_kg'),
        )
        serializer = QuotaDashboardSerializer(qs, many=True)
        return Response(serializer.data)


class PriceEntryViewSet(ModelViewSet):
    """
    GET   /api/v1/export/prices/          — list (filter by ?city=&days=7)
    POST  /api/v1/export/prices/          — create new price entry
    """

    permission_classes = [IsAuthenticated, write_permission(*_PRICE_WRITE_ROLES)]
    serializer_class = PriceEntrySerializer
    http_method_names = ['get', 'post', 'head', 'options']

    queryset = PriceEntry.objects.select_related('city', 'entered_by').order_by('-date', 'city__name')

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if city := params.get('city'):
            qs = qs.filter(city_id=city)
        if days := params.get('days'):
            try:
                cutoff = timezone.now().date() - datetime.timedelta(days=int(days))
                qs = qs.filter(date__gte=cutoff)
            except (ValueError, TypeError):
                pass
        return qs

    def perform_create(self, serializer):
        serializer.save(entered_by=self.request.user)


class WeeklyTruckAllocationViewSet(ModelViewSet):
    """
    GET    /api/v1/export/truck-allocations/        — list (filter ?season=&year=&week_number=)
    POST   /api/v1/export/truck-allocations/        — create; auto-computes total_trucks_calc
    PUT    /api/v1/export/truck-allocations/{id}/   — full update; recomputes total_trucks_calc
    PATCH  /api/v1/export/truck-allocations/{id}/   — partial update; recomputes if kg changed
    """

    permission_classes = [IsAuthenticated, write_permission(*_TRUCK_WRITE_ROLES)]
    serializer_class = WeeklyTruckAllocationSerializer
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']
    filterset_fields = ['season', 'year', 'week_number']

    queryset = WeeklyTruckAllocation.objects.select_related(
        'season', 'decided_by',
    ).prefetch_related(
        'destination_splits__destination',
    ).order_by('year', 'week_number', 'day_of_week')

    _TRUCK_CAPACITY_KG = Decimal('18500')

    def _compute_trucks_calc(self, total_planned_kg) -> Decimal | None:
        """Compute total_trucks_calc = total_planned_kg / 18500, rounded to 2 dp."""
        if total_planned_kg is None:
            return None
        return (Decimal(str(total_planned_kg)) / self._TRUCK_CAPACITY_KG).quantize(Decimal('0.01'))

    def perform_create(self, serializer):
        planned_kg = serializer.validated_data.get('total_planned_kg')
        serializer.save(
            decided_by=self.request.user,
            total_trucks_calc=self._compute_trucks_calc(planned_kg),
        )

    def perform_update(self, serializer):
        planned_kg = serializer.validated_data.get(
            'total_planned_kg',
            serializer.instance.total_planned_kg,
        )
        serializer.save(
            total_trucks_calc=self._compute_trucks_calc(planned_kg),
        )

    @action(detail=True, methods=['post'], url_path='set-splits')
    def set_splits(self, request, pk=None):
        """POST /api/v1/export/truck-allocations/{id}/set-splits/

        Body: { "splits": [{ "destination_id": 1, "truck_count": 3 }, ...] }
        Creates or updates TruckDestinationSplit rows for this allocation.
        """
        allocation = self.get_object()
        splits_data = request.data.get('splits', [])

        for item in splits_data:
            dest_id = item.get('destination_id')
            count = item.get('truck_count', 0)
            if dest_id is None:
                continue
            if not isinstance(count, int) or count < 0:
                return Response(
                    {'error': f'truck_count must be a non-negative integer, got {count!r}'},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            TruckDestinationSplit.objects.update_or_create(
                truck_allocation=allocation,
                destination_id=dest_id,
                defaults={'truck_count': count},
            )

        # Re-fetch with prefetches and return
        allocation.refresh_from_db()
        serializer = self.get_serializer(
            WeeklyTruckAllocation.objects.prefetch_related(
                'destination_splits__destination',
            ).get(pk=allocation.pk)
        )
        return Response(serializer.data)


class DomesticSaleViewSet(ModelViewSet):
    """
    GET    /api/v1/export/domestic-sales/        — list (filter ?block=&buyer=&export_firm=&date_from=&date_to=)
    POST   /api/v1/export/domestic-sales/        — create
    PATCH  /api/v1/export/domestic-sales/{id}/   — partial update
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
