"""ViewSets and APIViews for the quota issuance system.

QuotaIssuanceViewSet  — CRUD for issuances + /reassign/ action
QuotaDashboardView    — aggregated KPIs / per-firm / weekly-flow analytics
"""
import datetime
import logging
from decimal import Decimal

from django.db.models import F, Q, Sum
from django.db.models.functions import Coalesce
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action
from rest_framework import status as http_status

from apps.core.models import Season
from apps.core.permissions import write_permission
from apps.export.models import (
    QuotaIssuance,
    QuotaIssuanceFirmAllocation,
    ShipmentFirmSplit,
    WeeklyLocalSellPlan,
)
from apps.export.serializers_quota import (
    QuotaIssuanceSerializer,
    QuotaIssuanceCreateSerializer,
)

logger = logging.getLogger(__name__)

_QUOTA_WRITE_ROLES = ('export_manager', 'director')

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _week_monday(iso_year: int, iso_week: int) -> datetime.date:
    """Return the Monday date for a given ISO year + week."""
    # ISO weeks: week 1 contains the first Thursday of the year.
    jan4 = datetime.date(iso_year, 1, 4)
    monday_of_week1 = jan4 - datetime.timedelta(days=jan4.weekday())
    return monday_of_week1 + datetime.timedelta(weeks=iso_week - 1)


def _week_in_range(
    iso_year: int,
    iso_week: int,
    date_from: datetime.date,
    date_to: datetime.date,
) -> bool:
    """Return True if the Monday of the given ISO week falls within [date_from, date_to]."""
    monday = _week_monday(iso_year, iso_week)
    return date_from <= monday <= date_to


# ---------------------------------------------------------------------------
# QuotaIssuanceViewSet
# ---------------------------------------------------------------------------

class QuotaIssuanceViewSet(ModelViewSet):
    """
    GET    /api/v1/export/quota-issuances/           — list
    GET    /api/v1/export/quota-issuances/{id}/      — detail
    POST   /api/v1/export/quota-issuances/           — create (export_manager / director)
    PUT    /api/v1/export/quota-issuances/{id}/      — full update
    DELETE /api/v1/export/quota-issuances/{id}/      — delete
    PATCH  /api/v1/export/quota-issuances/{id}/reassign/ — manual week reassignment
    """

    permission_classes = [IsAuthenticated, write_permission(*_QUOTA_WRITE_ROLES)]
    http_method_names = ['get', 'post', 'put', 'delete', 'head', 'options']

    queryset = QuotaIssuance.objects.prefetch_related(
        'allocations__export_firm'
    ).order_by('issue_date')

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        if product_type := params.get('product_type'):
            qs = qs.filter(product_type=product_type)
        if date_from := params.get('date_from'):
            qs = qs.filter(issue_date__gte=date_from)
        if date_to := params.get('date_to'):
            qs = qs.filter(issue_date__lte=date_to)

        return qs

    def get_serializer_class(self):
        if self.request.method in ('POST', 'PUT'):
            return QuotaIssuanceCreateSerializer
        return QuotaIssuanceSerializer

    def perform_create(self, serializer) -> None:
        serializer.save(created_by=self.request.user)

    @action(
        detail=True,
        methods=['patch'],
        url_path='reassign',
        permission_classes=[IsAuthenticated, write_permission(*_QUOTA_WRITE_ROLES)],
        # Allow PATCH on this action only — the parent ViewSet excludes PATCH globally.
        http_method_names=['patch', 'head', 'options'],
    )
    def reassign(self, request: Request, pk=None) -> Response:
        """Manually reassign an issuance to a different ISO week/year.

        Body: { "matched_week": <int>, "matched_year": <int> }
        Sets is_manually_reassigned=True.
        """
        issuance: QuotaIssuance = self.get_object()

        matched_week = request.data.get('matched_week')
        matched_year = request.data.get('matched_year')

        if not matched_week or not matched_year:
            raise ValidationError({'detail': 'matched_week and matched_year are required.'})

        try:
            matched_week = int(matched_week)
            matched_year = int(matched_year)
        except (TypeError, ValueError):
            raise ValidationError({'detail': 'matched_week and matched_year must be integers.'})

        if not (1 <= matched_week <= 53):
            raise ValidationError({'detail': 'matched_week must be between 1 and 53.'})

        issuance.matched_week = matched_week
        issuance.matched_year = matched_year
        issuance.is_manually_reassigned = True
        issuance.save(update_fields=['matched_week', 'matched_year', 'is_manually_reassigned'])

        return Response(
            QuotaIssuanceSerializer(issuance, context={'request': request}).data
        )


# ---------------------------------------------------------------------------
# QuotaDashboardView
# ---------------------------------------------------------------------------

class QuotaDashboardView(APIView):
    """
    GET /api/v1/export/quota-dashboard/

    Query params:
        season      (int, required) — Season ID
        date_from   (YYYY-MM-DD, optional) — override season start
        date_to     (YYYY-MM-DD, optional) — override season end
        product_type (str, default 'tomato')

    Response:
        {
            kpis: { local_sales_kg, expected_kg, issued_kg, not_given_kg,
                    not_given_pct, used_kg, unused_kg, unused_pct },
            per_firm: [ { firm_id, firm_name, sales_kg, expected_kg, issued_kg,
                          used_kg, not_given_kg, not_given_pct, unused_kg, is_blocked } ],
            weekly_flow: [ { week, year, label, sales_kg, expected_kg,
                             issued_kg, gap_kg, coverage_pct,
                             issuances: [...], firms: {...} } ]
        }
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        params = request.query_params

        season_id = params.get('season')
        if not season_id:
            raise ValidationError({'detail': 'season query parameter is required.'})

        try:
            season = Season.objects.get(pk=season_id)
        except Season.DoesNotExist:
            raise ValidationError({'detail': f'Season {season_id} not found.'})

        product_type = params.get('product_type', 'tomato')

        # Date range — default to season boundaries, override with explicit params
        date_from: datetime.date = season.start_date
        date_to: datetime.date = season.end_date

        if raw := params.get('date_from'):
            try:
                date_from = datetime.date.fromisoformat(raw)
            except ValueError:
                raise ValidationError({'detail': f'Invalid date_from: {raw}'})

        if raw := params.get('date_to'):
            try:
                date_to = datetime.date.fromisoformat(raw)
            except ValueError:
                raise ValidationError({'detail': f'Invalid date_to: {raw}'})

        data = self._build_dashboard(date_from, date_to, product_type)
        return Response(data)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_dashboard(
        self,
        date_from: datetime.date,
        date_to: datetime.date,
        product_type: str,
    ) -> dict:
        local_sales = self._aggregate_local_sales(date_from, date_to)
        quota_issued = self._aggregate_quota_issued(date_from, date_to, product_type)
        quota_used = self._aggregate_quota_used(date_from, date_to)
        issuances_in_range = self._fetch_issuances(date_from, date_to, product_type)

        all_firm_ids = (
            set(local_sales.keys())
            | set(quota_issued.keys())
            | set(quota_used.keys())
        )

        # Resolve firm names once
        from apps.core.models import ExportFirm
        firm_names: dict[int, str] = {
            f.id: (f.name_en or f.name_tk or str(f.id))
            for f in ExportFirm.objects.filter(id__in=all_firm_ids).only('id', 'name_en', 'name_tk')
        }

        # --- KPIs ---
        total_sales_kg = sum(local_sales.values(), Decimal('0'))
        total_expected_kg = total_sales_kg * 10
        total_issued_kg = sum(quota_issued.values(), Decimal('0'))
        total_used_kg = sum(quota_used.values(), Decimal('0'))
        total_not_given_kg = total_expected_kg - total_issued_kg
        total_not_given_pct = (
            (total_not_given_kg / total_expected_kg * 100)
            if total_expected_kg > 0
            else Decimal('0')
        )
        total_unused_kg = max(total_issued_kg - total_used_kg, Decimal('0'))
        total_unused_pct = (
            (total_unused_kg / total_issued_kg * 100)
            if total_issued_kg > 0
            else Decimal('0')
        )

        kpis = {
            'local_sales_kg': total_sales_kg,
            'expected_kg': total_expected_kg,
            'issued_kg': total_issued_kg,
            'not_given_kg': total_not_given_kg,
            'not_given_pct': round(total_not_given_pct, 1),
            'used_kg': total_used_kg,
            'unused_kg': total_unused_kg,
            'unused_pct': round(total_unused_pct, 1),
        }

        # --- Per firm ---
        per_firm = []
        for firm_id in sorted(all_firm_ids):
            sales_kg = local_sales.get(firm_id, Decimal('0'))
            expected_kg = sales_kg * 10
            issued_kg = quota_issued.get(firm_id, Decimal('0'))
            used_kg = quota_used.get(firm_id, Decimal('0'))
            not_given_kg = expected_kg - issued_kg
            not_given_pct = (
                round(not_given_kg / expected_kg * 100, 1)
                if expected_kg > 0
                else Decimal('0')
            )
            unused_kg = max(issued_kg - used_kg, Decimal('0'))

            # Skip firms with zero activity in the selected period
            if sales_kg == 0 and issued_kg == 0 and used_kg == 0:
                continue

            per_firm.append({
                'export_firm': firm_id,
                'export_firm_name': firm_names.get(firm_id, str(firm_id)),
                'sales_kg': sales_kg,
                'expected_kg': expected_kg,
                'issued_kg': issued_kg,
                'used_kg': used_kg,
                'not_given_kg': not_given_kg,
                'not_given_pct': not_given_pct,
                'unused_kg': unused_kg,
                'is_blocked': sales_kg > 0 and issued_kg == 0,
            })

        # --- Weekly flow ---
        weekly_flow = self._build_weekly_flow(
            date_from, date_to, local_sales, quota_issued,
            quota_used, issuances_in_range, firm_names,
        )

        return {'kpis': kpis, 'per_firm': per_firm, 'weekly_flow': weekly_flow}

    def _aggregate_local_sales(
        self, date_from: datetime.date, date_to: datetime.date
    ) -> dict[int, Decimal]:
        """Sum Mon-Sat plan_kg per firm for weeks whose Monday falls in [date_from, date_to].

        Filters WeeklyLocalSellPlan rows by week, then sums the six daily plan columns.
        """
        # Pull all potentially-relevant plan rows and filter by week Monday in-range in Python.
        # This avoids a complex SQL expression for ISO week → Monday conversion on MSSQL.
        plans = WeeklyLocalSellPlan.objects.filter(
            year__gte=date_from.year - 1,
            year__lte=date_to.year + 1,
        ).values(
            'export_firm_id',
            'week_number',
            'year',
            'monday_plan_kg',
            'tuesday_plan_kg',
            'wednesday_plan_kg',
            'thursday_plan_kg',
            'friday_plan_kg',
            'saturday_plan_kg',
        )

        totals: dict[int, Decimal] = {}
        for row in plans:
            if not _week_in_range(row['year'], row['week_number'], date_from, date_to):
                continue
            week_kg = sum(
                (row[col] or Decimal('0'))
                for col in (
                    'monday_plan_kg', 'tuesday_plan_kg', 'wednesday_plan_kg',
                    'thursday_plan_kg', 'friday_plan_kg', 'saturday_plan_kg',
                )
            )
            firm_id = row['export_firm_id']
            totals[firm_id] = totals.get(firm_id, Decimal('0')) + week_kg

        return totals

    def _aggregate_quota_issued(
        self,
        date_from: datetime.date,
        date_to: datetime.date,
        product_type: str,
    ) -> dict[int, Decimal]:
        """Sum kg_quota per firm from allocations whose issuance.issue_date is in range."""
        rows = (
            QuotaIssuanceFirmAllocation.objects
            .filter(
                issuance__issue_date__gte=date_from,
                issuance__issue_date__lte=date_to,
                issuance__product_type=product_type,
            )
            .values('export_firm_id')
            .annotate(total=Coalesce(Sum('kg_quota'), Decimal('0')))
        )
        return {row['export_firm_id']: row['total'] for row in rows}

    def _aggregate_quota_used(
        self, date_from: datetime.date, date_to: datetime.date
    ) -> dict[int, Decimal]:
        """Sum weight_kg per firm from ShipmentFirmSplit where shipment departed in range.

        Falls back to shipment.date if departed_at is NULL.
        """
        rows = (
            ShipmentFirmSplit.objects
            .filter(
                Q(shipment__departed_at__date__gte=date_from, shipment__departed_at__date__lte=date_to)
                | Q(shipment__departed_at__isnull=True, shipment__date__gte=date_from, shipment__date__lte=date_to)
            )
            .values('export_firm_id')
            .annotate(total=Coalesce(Sum('weight_kg'), Decimal('0')))
        )
        return {row['export_firm_id']: row['total'] for row in rows}

    def _fetch_issuances(
        self,
        date_from: datetime.date,
        date_to: datetime.date,
        product_type: str,
    ) -> list:
        """Fetch QuotaIssuance objects in range with prefetched allocations."""
        return list(
            QuotaIssuance.objects
            .filter(
                issue_date__gte=date_from,
                issue_date__lte=date_to,
                product_type=product_type,
            )
            .prefetch_related('allocations')
            .order_by('issue_date')
        )

    def _build_weekly_flow(
        self,
        date_from: datetime.date,
        date_to: datetime.date,
        local_sales: dict[int, Decimal],
        quota_issued: dict[int, Decimal],
        quota_used: dict[int, Decimal],
        issuances: list,
        firm_names: dict[int, str],
    ) -> list[dict]:
        """Group local-sales plan rows into ISO weeks and compute flow metrics."""
        # Collect per-week, per-firm sales from plan rows
        plan_rows = WeeklyLocalSellPlan.objects.filter(
            year__gte=date_from.year - 1,
            year__lte=date_to.year + 1,
        ).values(
            'export_firm_id', 'week_number', 'year',
            'monday_plan_kg', 'tuesday_plan_kg', 'wednesday_plan_kg',
            'thursday_plan_kg', 'friday_plan_kg', 'saturday_plan_kg',
        )

        # week_key → firm_id → sales_kg
        week_firm_sales: dict[tuple, dict[int, Decimal]] = {}
        for row in plan_rows:
            key = (row['year'], row['week_number'])
            if not _week_in_range(row['year'], row['week_number'], date_from, date_to):
                continue
            week_kg = sum(
                (row[col] or Decimal('0'))
                for col in (
                    'monday_plan_kg', 'tuesday_plan_kg', 'wednesday_plan_kg',
                    'thursday_plan_kg', 'friday_plan_kg', 'saturday_plan_kg',
                )
            )
            if key not in week_firm_sales:
                week_firm_sales[key] = {}
            firm_id = row['export_firm_id']
            week_firm_sales[key][firm_id] = week_firm_sales[key].get(firm_id, Decimal('0')) + week_kg

        # Group issuances by their matched (year, week)
        week_issuances: dict[tuple, list] = {}
        for issuance in issuances:
            key = (issuance.matched_year, issuance.matched_week)
            if key not in week_issuances:
                week_issuances[key] = []
            week_issuances[key].append(issuance)

        # Build per-week-per-firm issued from issuance allocations
        week_firm_issued: dict[tuple, dict[int, Decimal]] = {}
        for issuance in issuances:
            key = (issuance.matched_year, issuance.matched_week)
            if key not in week_firm_issued:
                week_firm_issued[key] = {}
            for alloc in issuance.allocations.all():
                firm_id = alloc.export_firm_id
                week_firm_issued[key][firm_id] = (
                    week_firm_issued[key].get(firm_id, Decimal('0')) + alloc.kg_quota
                )

        # All weeks that appear in either plan or issuances
        all_week_keys = sorted(set(week_firm_sales.keys()) | set(week_issuances.keys()))

        result = []
        for key in all_week_keys:
            year, week = key
            monday = _week_monday(year, week)
            firm_sales_map = week_firm_sales.get(key, {})
            firm_issued_map = week_firm_issued.get(key, {})

            week_sales_kg = sum(firm_sales_map.values(), Decimal('0'))
            week_expected_kg = week_sales_kg * 10
            week_issued_kg = sum(firm_issued_map.values(), Decimal('0'))
            week_gap_kg = week_expected_kg - week_issued_kg
            coverage_pct = (
                round(week_issued_kg / week_expected_kg * 100, 1)
                if week_expected_kg > 0
                else Decimal('0')
            )

            # Per-firm breakdown for this week
            all_week_firm_ids = set(firm_sales_map.keys()) | set(firm_issued_map.keys())
            firms_breakdown = []
            for firm_id in sorted(all_week_firm_ids):
                f_sales = firm_sales_map.get(firm_id, Decimal('0'))
                f_issued = firm_issued_map.get(firm_id, Decimal('0'))
                f_expected = f_sales * 10
                firms_breakdown.append({
                    'firm_name': firm_names.get(firm_id, str(firm_id)),
                    'sold_kg': f_sales,
                    'expected_kg': f_expected,
                    'got_kg': f_issued,
                    'diff_kg': f_issued - f_expected,
                })

            # Issuance summaries for this week
            issuance_summaries = [
                {
                    'id': iss.id,
                    'issue_date': str(iss.issue_date),
                    'total_kg': iss.total_kg,
                    'is_manually_reassigned': iss.is_manually_reassigned,
                }
                for iss in week_issuances.get(key, [])
            ]

            saturday = monday + datetime.timedelta(days=5)
            result.append({
                'week': week,
                'year': year,
                'date_from': str(monday),
                'date_to': str(saturday),
                'sales_kg': week_sales_kg,
                'expected_kg': week_expected_kg,
                'issued_kg': week_issued_kg,
                'gap_kg': week_gap_kg,
                'coverage_pct': coverage_pct,
                'issuances': issuance_summaries,
                'firms': firms_breakdown,
            })

        return result
