"""ViewSets and APIViews for the quota issuance system.

QuotaIssuanceViewSet  — CRUD for issuances + /reassign/ action
QuotaDashboardView    — aggregated KPIs / per-firm / weekly-flow analytics
"""
import datetime
import logging

from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action

from apps.core.models import Season
from apps.core.permissions import write_permission, DynamicResourcePermission
from apps.core.roles import QUOTA_WRITE
from apps.export.models import QuotaIssuance
from apps.export.serializers_quota import (
    QuotaIssuanceSerializer,
    QuotaIssuanceCreateSerializer,
)
from apps.export.services_quota import build_quota_dashboard

logger = logging.getLogger(__name__)


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

    resource_code = 'quota_issuance'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
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
        if self.request.method == 'POST':
            return QuotaIssuanceCreateSerializer
        return QuotaIssuanceSerializer

    def perform_create(self, serializer) -> None:
        serializer.save(created_by=self.request.user)

    @action(
        detail=True,
        methods=['patch'],
        url_path='reassign',
        permission_classes=[IsAuthenticated, DynamicResourcePermission],
        http_method_names=['patch', 'head', 'options'],
    )
    def reassign(self, request: Request, pk=None) -> Response:
        """Manually reassign an issuance to a different ISO week/year.

        Body: { "matched_week": <int>, "matched_year": <int> }
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
    """GET /api/v1/export/quota-dashboard/

    Query params:
        season       (int, required)
        date_from    (YYYY-MM-DD, optional)
        date_to      (YYYY-MM-DD, optional)
        product_type (str, default 'tomato')
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        """Parse query params and delegate to service layer."""
        params = request.query_params

        season_id = params.get('season')
        if not season_id:
            raise ValidationError({'detail': 'season query parameter is required.'})

        try:
            season = Season.objects.get(pk=season_id)
        except Season.DoesNotExist:
            raise ValidationError({'detail': f'Season {season_id} not found.'})

        product_type = params.get('product_type', 'tomato')
        date_from = _parse_date(params.get('date_from'), season.start_date, 'date_from')
        date_to = _parse_date(params.get('date_to'), season.end_date, 'date_to')

        data = build_quota_dashboard(date_from, date_to, product_type)
        return Response(data)


def _parse_date(raw: str | None, default: datetime.date, field_name: str) -> datetime.date:
    """Parse an ISO date string, falling back to default if None."""
    if not raw:
        return default
    try:
        return datetime.date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({'detail': f'Invalid {field_name}: {raw}'})
