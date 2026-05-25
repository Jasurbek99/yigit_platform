"""ViewSets and APIViews for the quota issuance system.

QuotaIssuanceViewSet  — CRUD for issuances + /reassign/ action
QuotaDashboardView    — aggregated KPIs / per-firm / weekly-flow analytics
"""
import datetime
import logging

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action

from apps.core.models import Season
from apps.core.permissions import write_permission, DynamicResourcePermission
from apps.core.roles import QUOTA_WRITE

from apps.export.models import QuotaIssuance, QuotaUsageRecord
from apps.export.models.audit import AuditLog
from apps.export.serializers_quota import (
    QuotaIssuanceSerializer,
    QuotaIssuanceCreateSerializer,
    QuotaUsageRecordSerializer,
)
from apps.export.services_quota import build_quota_dashboard, compute_fifo_usage

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
    http_method_names = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

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

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.request.method == 'GET':
            product_type = self.request.query_params.get('product_type', 'tomato')
            ctx['usage_map'] = compute_fifo_usage(product_type)
        return ctx

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
# QuotaUsageViewSet
# ---------------------------------------------------------------------------

class QuotaUsageViewSet(ModelViewSet):
    """
    GET    /api/v1/export/quota-usage/              — list (filterable)
    GET    /api/v1/export/quota-usage/{id}/         — detail
    PATCH  /api/v1/export/quota-usage/{id}/         — partial edit (draft only)
    DELETE /api/v1/export/quota-usage/{id}/         — delete (draft only)
    POST   /api/v1/export/quota-usage/approve/      — bulk approve
    """

    resource_code = 'quota_usage'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = QuotaUsageRecordSerializer
    pagination_class = None  # Grid view needs all records; volume is bounded by season
    http_method_names = ['get', 'patch', 'delete', 'post', 'head', 'options']

    queryset = QuotaUsageRecord.objects.select_related(
        'export_firm', 'shipment', 'approved_by', 'created_by',
    ).order_by('-usage_date', 'export_firm')

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if status := params.get('status'):
            qs = qs.filter(status=status)
        if product_type := params.get('product_type'):
            qs = qs.filter(product_type=product_type)
        if date_from := params.get('date_from'):
            qs = qs.filter(usage_date__gte=date_from)
        if date_to := params.get('date_to'):
            qs = qs.filter(usage_date__lte=date_to)
        return qs

    def perform_create(self, serializer) -> None:
        instance = serializer.save(created_by=self.request.user)
        AuditLog.objects.create(
            user=self.request.user,
            action='create',
            model_name='QuotaUsageRecord',
            object_id=instance.pk,
            object_repr=str(instance),
            detail=f'{instance.usage_date} firm={instance.export_firm_id} {instance.kg_used} kg',
        )

    def perform_update(self, serializer):
        if serializer.instance.status != 'draft':
            raise ValidationError({'detail': 'Only draft records can be edited.'})
        instance = serializer.save()
        AuditLog.objects.create(
            user=self.request.user,
            action='update',
            model_name='QuotaUsageRecord',
            object_id=instance.pk,
            object_repr=str(instance),
            detail=f'{instance.usage_date} firm={instance.export_firm_id} {instance.kg_used} kg',
        )

    def perform_destroy(self, instance):
        if instance.status != 'draft':
            raise ValidationError({'detail': 'Only draft records can be deleted.'})
        instance.delete()

    @action(detail=False, methods=['post'], url_path='approve')
    def approve(self, request: Request) -> Response:
        """Bulk approve draft usage records.

        Requires ``can_edit`` on the ``quota_usage`` resource (checked via
        DynamicResourcePermission registry, not a hardcoded role list).

        Body: { "ids": [1, 2, 3] }
        """
        from apps.core.permissions import get_resource_perm

        if not request.user.is_superuser:
            role = getattr(request.user, 'role', None)
            perm = get_resource_perm(role, 'quota_usage') if role else None
            if not perm or not perm.get('can_edit'):
                raise PermissionDenied('You do not have permission to approve quota usage records.')

        ids = request.data.get('ids', [])
        if not ids:
            raise ValidationError({'detail': 'ids list is required.'})

        with transaction.atomic():
            approved_qs = QuotaUsageRecord.objects.filter(id__in=ids, status='draft')
            approved_ids = list(approved_qs.values_list('id', flat=True))
            updated = approved_qs.update(
                status='approved',
                approved_by_id=request.user.pk,
                approved_at=timezone.now(),
            )
            if approved_ids:
                AuditLog.objects.bulk_create([
                    AuditLog(
                        user=request.user,
                        action='update',
                        model_name='QuotaUsageRecord',
                        object_id=pk,
                        object_repr=f'QuotaUsageRecord#{pk}',
                        detail=f'Bulk approved (draft → approved)',
                    )
                    for pk in approved_ids
                ], batch_size=500)
            # Invalidate FIFO cache since approved usage totals changed
            from django.core.cache import cache
            cache.delete('fifo_usage:tomato')
            cache.delete('fifo_usage:pepper')
        return Response({'approved': updated})


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

    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    resource_code = 'quota'

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

        # Normalize so ?product_type=Tomato and =tomato don't cache twice (and
        # the service gets a consistent value).
        product_type = params.get('product_type', 'tomato').lower()
        date_from = _parse_date(params.get('date_from'), season.start_date, 'date_from')
        date_to = _parse_date(params.get('date_to'), season.end_date, 'date_to')

        # build_quota_dashboard() runs several aggregation passes per request and
        # was uncached (unlike dashboard_summary / boss / KPI endpoints). Cache it
        # for 60s keyed by every param that changes the result. Quota approvals
        # are infrequent and analytics tolerate ≤60s staleness — same tradeoff as
        # the other dashboards.
        cache_key = f'quota_dashboard:{season_id}:{product_type}:{date_from}:{date_to}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        data = build_quota_dashboard(date_from, date_to, product_type)
        cache.set(cache_key, data, 60)
        return Response(data)


def _parse_date(raw: str | None, default: datetime.date, field_name: str) -> datetime.date:
    """Parse an ISO date string, falling back to default if None."""
    if not raw:
        return default
    try:
        return datetime.date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({'detail': f'Invalid {field_name}: {raw}'})
