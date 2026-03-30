import datetime
import logging
from decimal import Decimal

from django.db.models import F
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from apps.core.permissions import write_permission
from apps.export.models import WeeklyHarvestPlan, WeeklyTruckAllocation, QuotaAllocation, PriceEntry, DomesticSale
from apps.export.serializers_planning import (
    WeeklyHarvestPlanSerializer,
    WeeklyTruckAllocationSerializer,
    QuotaAllocationSerializer,
    PriceEntrySerializer,
    QuotaDashboardSerializer,
    DomesticSaleSerializer,
)

logger = logging.getLogger(__name__)

_PLAN_WRITE_ROLES = frozenset({'greenhouse_manager', 'export_manager', 'director'})
_TRUCK_WRITE_ROLES = frozenset({'export_manager', 'director'})
_DOMESTIC_WRITE_ROLES = frozenset({'warehouse_chief', 'greenhouse_manager', 'export_manager', 'director'})
_PRICE_WRITE_ROLES = frozenset({'export_manager', 'finansist', 'director'})


def _check_write_role(user, allowed: frozenset, action: str = 'write') -> None:
    """Raise PermissionDenied if user.role is not in allowed set."""
    if getattr(user, 'role', None) not in allowed:
        raise PermissionDenied(f"Role '{user.role}' is not allowed to {action}.")


class WeeklyHarvestPlanViewSet(ModelViewSet):
    """
    GET    /api/v1/export/harvest-plans/            — list (filter by ?season=&block=&year=&week=)
    GET    /api/v1/export/harvest-plans/{id}/       — detail
    POST   /api/v1/export/harvest-plans/            — create (greenhouse_manager / export_manager)
    PUT    /api/v1/export/harvest-plans/{id}/       — update plan values
    """

    permission_classes = [IsAuthenticated, write_permission(*_PLAN_WRITE_ROLES)]
    serializer_class = WeeklyHarvestPlanSerializer
    http_method_names = ['get', 'post', 'put', 'head', 'options']

    queryset = WeeklyHarvestPlan.objects.select_related('season', 'block', 'entered_by').order_by(
        'year', 'week_number', 'block__code'
    )

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

    def perform_create(self, serializer):
        serializer.save(entered_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(entered_by=self.request.user)

    @action(detail=False, methods=['get'], url_path='block-summary')
    def block_summary(self, request):
        """GET /api/v1/export/harvest-plans/block-summary/?season=&year=&week=

        Returns per-block aggregate totals across all 6 days.
        Does NOT filter by ?block= — always returns all blocks for the given week.
        """
        # Build queryset independently — do NOT inherit the ?block= filter from get_queryset()
        qs = WeeklyHarvestPlan.objects.select_related('block')
        params = request.query_params
        if season := params.get('season'):
            qs = qs.filter(season_id=season)
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if week := params.get('week'):
            qs = qs.filter(week_number=week)

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

    queryset = WeeklyTruckAllocation.objects.select_related('season', 'decided_by').order_by(
        'year', 'week_number', 'day_of_week'
    )

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
