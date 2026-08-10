"""ViewSets and APIViews for the quota issuance system.

QuotaIssuanceViewSet  — CRUD for issuances + /reassign/ action
QuotaDashboardView    — aggregated KPIs / per-firm / weekly-flow analytics
"""
import datetime
import logging

from django.core.cache import cache
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action

from apps.core.permissions import DynamicResourcePermission, SeasonNotClosed
from apps.core.seasons import (
    SeasonScopedMixin, can_view_closed, get_active_season, resolve_season,
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
    empty_quota_dashboard,
    season_of_usage,
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
            # for the SAME season the row belongs to — otherwise `used_kg`
            # describes a different season's ledger.
            #
            # List and detail need DIFFERENT seasons, and using the resolved one
            # for both is wrong on the detail route: detail bypasses season
            # scoping by design (Rule A), so a direct link to a prior season's
            # issuance resolves — but `resolve_season()` on an un-parameterised
            # GET returns the ACTIVE season, whose ledger does not contain this
            # allocation. The row came back reporting `used_kg: 0.00` where the
            # truth was its full consumption. The row's own `season` is the only
            # correct answer for a route that ignores the request's.
            if self.action == 'list':
                season = resolve_season(self.request)
            else:
                season = getattr(self.get_object(), 'season', None)
            ctx['usage_map'] = compute_fifo_usage(product_type, season)
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
    POST   /api/v1/export/quota-usage/              — create a manual row
    PATCH  /api/v1/export/quota-usage/{id}/         — partial edit
    DELETE /api/v1/export/quota-usage/{id}/         — delete

    There is no approval step. Usage counts the moment it exists — rows are born
    `status='approved'` (see `quota_sync.sync_draft_quota_usage_for_shipment`),
    `POST /approve/` is gone, and edit/delete are no longer gated on `status`.
    Read `status='approved'` as "counted", not "a human signed it": `approved_by`
    and `approved_at` stay NULL on everything the system creates. The column
    survives only to carry the pre-2026-08-10 history.

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
    # NO `season_field` / `include_null_link` here, deliberately. Both are read
    # by `SeasonScopedMixin.apply_season_scope()` and by nothing else — the
    # write-freeze helpers (`assert_create_target_open` /
    # `assert_update_target_open`) resolve through `freeze_season_of()` instead
    # — and this viewset overrides `apply_season_scope()` outright, so they
    # would be dead attributes. Leaving `include_null_link = True` visible here
    # was worse than dead: it advertises "this row shows under every open
    # season", which is precisely what D11 forbids. The read scope is owned
    # entirely by the override below.
    #
    # The write freeze resolves through `QuotaUsageRecord.freeze_season`
    # (added 2026-08-08), which anchors an unlinked row on `usage_date` exactly
    # as `usage_season_q()` does. Before it, `freeze_season_of()` returned None
    # for every unlinked row and BOTH layers were no-ops on them: POST into a
    # closed season returned 201, PATCH into one 200, DELETE 204.

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
        # `?shipment=` backs the quota card on ShipmentDetail — "which firms
        # burned quota on THIS truck". Same param name and meaning as
        # `/customs-expenses/?shipment=`.
        shipment_id = params.get('shipment')
        if shipment_id:
            qs = qs.filter(shipment_id=shipment_id)
        if self.action == 'list':
            # Copied verbatim from `CustomsExpenseViewSet.get_queryset()`, which
            # solved the same problem for the expenses panel on the same page.
            # `?shipment=` pins the request to one truck, so Rule A (§4.5) applies
            # — a detail page resolves for any season, and a prior-season shipment
            # opened by direct link must show its own quota rather than an empty
            # card contradicting the rows that plainly exist.
            #
            # The bypass is NOT unconditional. `can_view_closed()` still gates it,
            # so a role holding `quota_usage` but not `closed_season` stays scoped
            # even with `?shipment=` — otherwise this param would be a way around
            # the 403 that `/quota-usage/?season=<closed>` returns, which is the
            # exact shape of the 2026-08-07 quota-dashboard date-window bypass.
            # `resolve_season()` runs unconditionally either way, so the close→open
            # gap still fails closed and a bad/closed `?season=` still 404s/403s.
            season = resolve_season(self.request)
            if shipment_id and season is not None and can_view_closed(self.request.user):
                pass
            else:
                qs = self.apply_season_scope(qs, season=season)
        return qs

    def _assert_usage_resolves_to_a_season(self, serializer) -> None:
        """Reject a write that would leave the row belonging to NO season (D11).

        Before D11, `include_null_link` surfaced every unlinked row under the
        active season, so an out-of-range `usage_date` was survivable. Now
        `usage_season_q()` matches such a row for no season at all: it vanishes
        the instant it saves and is counted in no ledger. Both `usage_date` and
        `shipment` are writable on this serializer, and the quota-usage grid
        POSTs no shipment, so the gap is reachable straight from the UI.

        Mirrors the identical guard on `QuotaIssuanceViewSet.perform_create`.
        Checks the values the row will have AFTER the write, so a PATCH that
        moves `usage_date` into the gap is caught too.

        Scope, deliberately narrow: this is a 400 about the FIELD (`usage_date`
        names no season). A row that resolves to a CLOSED season is a different
        failure — a write against frozen data — and is rejected with the
        branch's `409 season_closed` by `assert_create_target_open()` /
        `assert_update_target_open()`, which run BEFORE this guard and now
        resolve through `QuotaUsageRecord.freeze_season`. Folding the closed
        case in here as a 400 would report frozen data as a bad field and would
        duplicate the freeze rule in a second place.
        """
        data = serializer.validated_data
        instance = serializer.instance
        shipment = data.get('shipment', getattr(instance, 'shipment', None))
        usage_date = data.get('usage_date', getattr(instance, 'usage_date', None))
        if season_of_usage(shipment, usage_date) is None:
            raise ValidationError({
                'usage_date': (
                    f'{usage_date} falls outside every season. A usage record with '
                    'no shipment must be dated inside a season, or it belongs to '
                    'none and is counted in no quota balance.'
                ),
            })

    def perform_create(self, serializer) -> None:
        # Write freeze (D1): CreateModelMixin never calls get_object(), so
        # the SeasonNotClosed object permission cannot fire on a create.
        self.assert_create_target_open(serializer)
        self._assert_usage_resolves_to_a_season(serializer)
        # Server-set, never taken from the request: a manually-entered row counts
        # the same instant an auto-generated one does. `approved_by` stays NULL —
        # see the class docstring on what 'approved' means now.
        instance = serializer.save(created_by=self.request.user, status='approved')
        invalidate_quota_caches()
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
        self._assert_usage_resolves_to_a_season(serializer)
        # No draft-only gate. `status` no longer records a review — every row is
        # 'approved' from birth, so gating edits on it would freeze the grid and
        # make manually-entered rows uncorrectable. Permissions and the season
        # write freeze are the only things that may refuse an edit now.
        instance = serializer.save()
        AuditLog.objects.create(
            user=self.request.user,
            action='update',
            model_name='QuotaUsageRecord',
            object_id=instance.pk,
            object_repr=str(instance),
            detail=f'{instance.usage_date} firm={instance.export_firm_id} {instance.kg_used} kg',
        )
        # Every row counts now, so every edit moves a firm's balance. Under the
        # old workflow only `/approve/` did, which is why this call was only
        # there.
        invalidate_quota_caches()

    def perform_destroy(self, instance):
        instance.delete()
        invalidate_quota_caches()


# ---------------------------------------------------------------------------
# QuotaDashboardView
# ---------------------------------------------------------------------------

class QuotaDashboardView(APIView):
    """GET /api/v1/export/quota-dashboard/

    Query params:
        season       (int, optional — defaults to the active season)
        date_from    (YYYY-MM-DD, optional — defaults to the season's start)
        date_to      (YYYY-MM-DD, optional — defaults to the season's end)
        product_type (str, default 'tomato')

    The season goes through `resolve_season()` like every other read path
    (AD-16). This view used to read `?season=` directly and look the row up
    itself, which meant `closed_season.can_view` was never consulted:
    `document_team` / `loading_dept_head` (+deputy) hold `quota_issuance` but
    not `closed_season`, so they were correctly 403'd on
    `/quota-issuances/?season=<closed>` yet could still read that season's
    aggregates here.
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

        # Resolve BEFORE the cache lookup: this is where the 404 (unknown id)
        # and the 403 (closed season without `closed_season.can_view`) come
        # from, and a cached payload must never be served past them.
        season = resolve_season(request)
        if season is None:
            # D7 fail-closed. During the close→open gap there is no season to
            # report on, so return the empty payload with its shape intact
            # rather than the just-closed season's numbers (which the old
            # `?season=` requirement would still have served on request) or an
            # error the page renders as a red banner. Same call
            # `dashboard/summary` makes. Nothing is queried, so nothing is
            # cached either.
            return Response(empty_quota_dashboard())

        # Normalize so ?product_type=Tomato and =tomato don't cache twice (and
        # the service gets a consistent value).
        product_type = params.get('product_type', 'tomato').lower()

        # CLAMP the window to the resolved season — do not merely default to it.
        # `build_quota_dashboard()` aggregates on dates alone, so an unclamped
        # `?date_from=`/`?date_to=` walks straight past the permission gate:
        # `document_team` (holds `quota_issuance`, not `closed_season`) sends the
        # closed season's own range with NO `?season=`, `resolve_season()`
        # returns the ACTIVE season, the gate passes, and the response carries
        # the closed season's aggregates — the very payload the 403 above
        # exists to withhold.
        #
        # A clamp, not a season predicate on the aggregates: it is monotonically
        # restrictive, so it changes no number for any window already inside the
        # season, and it needs no ruling on whether `build_quota_dashboard()`
        # should take a season FK (that question stays open — see AD-16). When
        # the requested window lies wholly outside the season the clamp inverts
        # it (`date_from > date_to`), which every aggregate reads as an empty
        # range — fail closed, the right answer for a window the caller may not
        # see.
        date_from = max(
            _parse_date(params.get('date_from'), season.start_date, 'date_from'),
            season.start_date,
        )
        date_to = min(
            _parse_date(params.get('date_to'), season.end_date, 'date_to'),
            season.end_date,
        )

        # build_quota_dashboard() runs several aggregation passes per request and
        # was uncached (unlike dashboard_summary / boss / KPI endpoints). Cache it
        # for 60s keyed by every param that changes the result. Quota approvals
        # are infrequent and analytics tolerate ≤60s staleness — same tradeoff as
        # the other dashboards.
        #
        # `season.pk`, not the raw `?season=` string: with the parameter now
        # optional, the raw value is None on every default request, so two
        # seasons sharing a date window would collide on one key. Same shape as
        # `QuotaFirmBalancesView`'s key below.
        cache_key = f'quota_dashboard:{season.pk}:{product_type}:{date_from}:{date_to}'
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
