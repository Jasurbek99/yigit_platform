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
from apps.core.permissions import write_permission, DynamicResourcePermission, SeasonNotClosed
from apps.core.roles import QUOTA_WRITE
from apps.core.seasons import (
    SeasonScopedMixin, assert_bulk_seasons_open, get_active_season, resolve_season,
)

from apps.export.models import QuotaIssuance, QuotaUsageRecord
from apps.export.models.audit import AuditLog
from apps.export.serializers_quota import (
    QuotaIssuanceSerializer,
    QuotaIssuanceCreateSerializer,
    QuotaUsageRecordSerializer,
)
from apps.export.services_quota import (
    build_quota_dashboard,
    compute_fifo_usage,
    compute_firm_quota_balances,
    usage_season_q,
)
from apps.export.services.quota_sync import invalidate_quota_caches

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# QuotaIssuanceViewSet
# ---------------------------------------------------------------------------

class QuotaIssuanceViewSet(SeasonScopedMixin, ModelViewSet):
    """
    GET    /api/v1/export/quota-issuances/           — list
    GET    /api/v1/export/quota-issuances/{id}/      — detail
    POST   /api/v1/export/quota-issuances/           — create (export_manager / director)
    PUT    /api/v1/export/quota-issuances/{id}/      — full update
    DELETE /api/v1/export/quota-issuances/{id}/      — delete
    PATCH  /api/v1/export/quota-issuances/{id}/reassign/ — manual week reassignment
    """

    resource_code = 'quota_issuance'
    # D11 (spec §4.7): season-scoped for READS as well as the write freeze,
    # reversing D10's opt-out. Quota never crosses a season boundary in either
    # direction, so the `season` FK added for `freeze_season_of()` now also
    # drives the read scope. `include_null_link` stays False and cannot be
    # turned on here: a direct `season` FK has no separate anchor column to
    # test for NULL. Consequence, deliberate and reported rather than papered
    # over — an issuance whose `issue_date` falls in the gap between two
    # seasons carries `season = NULL` and is reachable by direct link only
    # (QuotaIssuance#34 on the dev database, 25,000 kg, 2026-07-06).
    #
    # SeasonNotClosed covers PUT/PATCH/DELETE on the detail route via
    # get_object(); create is guarded in perform_create below.
    permission_classes = [IsAuthenticated, DynamicResourcePermission, SeasonNotClosed]
    http_method_names = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
    season_field = 'season'

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
        # Gated on `list` so detail routes still resolve across seasons — that
        # is what lets a write to a closed-season issuance return 409 rather
        # than 404 (Rule A).
        if self.action == 'list':
            qs = self.apply_season_scope(qs)
        return qs

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return QuotaIssuanceCreateSerializer
        return QuotaIssuanceSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.request.method == 'GET':
            product_type = self.request.query_params.get('product_type', 'tomato')
            # The FIFO ledger is per-season under D11, so it must be computed
            # for the SAME season the rows were listed under — otherwise the
            # consumed_kg column would describe a different season's ledger.
            ctx['usage_map'] = compute_fifo_usage(product_type, resolve_season(self.request))
        return ctx

    def perform_create(self, serializer) -> None:
        # D10: stamp the write-freeze anchor server-side, mirroring the
        # Shipment precedent — get_active_season() can never be closed, so no
        # request-level season guard is needed here (unlike perform_update /
        # the reassign action, which reach an EXISTING, possibly-closed row).
        season = get_active_season()
        if season is None:
            # D11 turned a harmless NULL into an invisible row: with reads now
            # scoped, an issuance created during the close→open gap would be
            # stamped with no season and disappear from every screen the moment
            # it was saved. Refusing is the only honest answer — we cannot
            # guess which season a gap-dated issuance belongs to.
            raise ValidationError({
                'detail': 'No active season. Open a season before recording a quota issuance.',
            })
        serializer.save(created_by=self.request.user, season=season)
        # New allocations change issued_kg → remaining_kg; bust the caches the
        # Sheet firm-split editor reads or a firm stays "no quota"/unselectable.
        invalidate_quota_caches()

    def perform_update(self, serializer) -> None:
        serializer.save()
        invalidate_quota_caches()

    def perform_destroy(self, instance) -> None:
        instance.delete()
        invalidate_quota_caches()

    @action(
        detail=True,
        methods=['patch'],
        url_path='reassign',
        # @action's own permission_classes kwarg REPLACES the class-level list
        # for this route entirely (DRF routes it through a separate as_view()
        # call) — SeasonNotClosed must be repeated here or a closed-season
        # issuance stays reassignable through this one action.
        permission_classes=[IsAuthenticated, DynamicResourcePermission, SeasonNotClosed],
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

class QuotaUsageViewSet(SeasonScopedMixin, ModelViewSet):
    """
    GET    /api/v1/export/quota-usage/              — list (filterable)
    GET    /api/v1/export/quota-usage/{id}/         — detail
    PATCH  /api/v1/export/quota-usage/{id}/         — partial edit (draft only)
    DELETE /api/v1/export/quota-usage/{id}/         — delete (draft only)
    POST   /api/v1/export/quota-usage/approve/      — bulk approve

    List is scoped to the resolved season via `usage_season_q()` (D11), which
    anchors a linked row on `shipment.season` and an unlinked one on its
    `usage_date` falling inside the season's range. `QuotaUsageRecord.shipment`
    is nullable ("null for imported historical records" — pre-dates this table's
    shipment link) and 575 of 711 rows on the dev database have no shipment at
    all. The pre-D11 `include_null_link` treatment surfaced every one of those
    under *every* open season; under "quota never crosses a season boundary"
    each belongs to exactly one, so the date is used as the anchor of last
    resort instead. Display and consumption share the one predicate on purpose:
    a row the grid shows must be a row FIFO counts.

    Detail routes bypass scoping — Rule A.
    """

    resource_code = 'quota_usage'
    permission_classes = [IsAuthenticated, DynamicResourcePermission, SeasonNotClosed]
    serializer_class = QuotaUsageRecordSerializer
    pagination_class = None  # Grid view needs all records; volume is bounded by season
    http_method_names = ['get', 'patch', 'delete', 'post', 'head', 'options']
    # `season_field` is still what the write-freeze helpers on the mixin read;
    # only the READ scope is overridden below, because the mixin's Q builder
    # cannot express the date-based fallback an unlinked row needs.
    season_field = 'shipment__season'
    include_null_link = True

    queryset = QuotaUsageRecord.objects.select_related(
        'export_firm', 'shipment', 'approved_by', 'created_by',
    ).order_by('-usage_date', 'export_firm')

    def apply_season_scope(self, qs, season=SeasonScopedMixin._SEASON_NOT_GIVEN):
        """Override: anchor unlinked rows on `usage_date`, not on "every season".

        `SeasonScopedMixin` can only build `Q(season_field=season)` plus an
        optional `anchor IS NULL`, and "IS NULL" means *every* open season —
        which D11 forbids. `usage_season_q()` is the same predicate FIFO and the
        firm balances use, so the grid and the ledger can never disagree about
        which rows belong to the season on screen.
        """
        if season is SeasonScopedMixin._SEASON_NOT_GIVEN:
            season = resolve_season(self.request)
        if season is None:
            return qs.none()  # D7 fail closed
        return qs.filter(usage_season_q(season))

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
        if self.action == 'list':
            qs = self.apply_season_scope(qs)
        return qs

    def perform_create(self, serializer) -> None:
        # Write freeze (D1): CreateModelMixin never calls get_object(), so
        # the SeasonNotClosed object permission cannot fire on a create.
        self.assert_create_target_open(serializer)
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
        # Write freeze (D1): layer 1 checked the anchor the row has BEFORE
        # the write; this checks the one it would have AFTER, so a PATCH
        # cannot move the row into a closed season.
        self.assert_update_target_open(serializer)
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
            # Write freeze (D1). Bulk approve selects by a raw id list, so
            # layer 1 never sees these rows; the season is reached through
            # `shipment` (nullable — a NULL-shipment historical import belongs
            # to no season and is therefore never frozen).
            assert_bulk_seasons_open(approved_qs, 'shipment__season')
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
            # Bust FIFO + firm-balance caches once approved usage totals change.
            # on_commit (not a bare call): we're inside transaction.atomic(), so a
            # bare delete would drop the cache BEFORE this UPDATE commits — a
            # concurrent read could then repopulate it with pre-approval numbers
            # that stick for the full 60s TTL. Deferring to commit closes that race.
            transaction.on_commit(invalidate_quota_caches)
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
    # Read-only quota analytics gated by view access to the underlying issuance
    # data. There is no standalone 'quota' resource in RESOURCE_REGISTRY — using
    # it here meant get_resource_perm() returned None and every non-superuser
    # role (export_manager, document_team, director) got a 403. 'quota_issuance'
    # is the actual aggregated resource and is held by exactly the roles that can
    # see the export.quota page.
    resource_code = 'quota_issuance'

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


# ---------------------------------------------------------------------------
# QuotaFirmBalancesView
# ---------------------------------------------------------------------------

class QuotaFirmBalancesView(APIView):
    """GET /api/v1/export/quota-firm-balances/?product_type=tomato&season=<id>

    Per-firm remaining quota for the RESOLVED season (D11 — quota never crosses
    a season boundary, so the balance follows the season being browsed rather
    than the write target), consumed by the firm-split editor to softly warn
    when a chosen firm has no quota left to assign. Empty during the close→open
    gap, per D7.

    Gated by the same resource as the dashboard ('quota_issuance' view) — which
    is exactly the set of roles that may edit shipment firm splits
    (export_manager, document_team, director, admin).

    Response: { "<firm_id>": {"issued_kg", "used_kg", "remaining_kg"}, ... }
    Firms absent from the map have no allocation (treat as zero remaining).
    """

    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    resource_code = 'quota_issuance'

    def get(self, request: Request) -> Response:
        product_type = request.query_params.get('product_type', 'tomato').lower()
        season = resolve_season(request)
        if season is None:
            return Response({})

        # Season in the key, or switching seasons serves the previous season's
        # balances for up to the 60s TTL. `invalidate_quota_caches()` busts
        # every season's key.
        cache_key = f'quota_firm_balances:{product_type}:{season.pk}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        balances = compute_firm_quota_balances(product_type, season)
        data = {str(firm_id): vals for firm_id, vals in balances.items()}
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
