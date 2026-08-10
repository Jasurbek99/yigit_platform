import logging
from datetime import date as _date
from decimal import Decimal

from django.db.models import Count, DecimalField, Exists, OuterRef, Q, QuerySet, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.core.idempotency import idempotent
from apps.core.permissions import DynamicResourcePermission, SeasonNotClosed
from apps.core.roles import ADVANCE_WRITE
from apps.core.seasons import (
    SeasonScopedMixin, assert_bulk_seasons_open, assert_season_open,
    can_view_closed, resolve_season,
)
from apps.export.models import (
    CustomsExpense,
    CustomsExpenseCategory,
    FinansistAdvance,
    FinansistAdvanceShipment,
    Shipment,
)
from apps.export.serializers import (
    CustomsExpenseSerializer,
    FinansistAdvanceCreateSerializer,
    FinansistAdvanceDetailSerializer,
    FinansistAdvanceListSerializer,
)

logger = logging.getLogger(__name__)

# Roles that may create or reconcile advances
_ADVANCE_WRITE_ROLES: frozenset[str] = ADVANCE_WRITE


def _customs_expense_season_q(season) -> Q:
    """Season-scope Q for CustomsExpense, matching
    `SeasonScopedMixin.apply_season_scope()`'s `include_null_link` semantics
    for `season_field='shipment__season'`. A free function (not just the
    mixin) because `CustomsExpenseViewSet.ledger()` builds its own queryset,
    bypassing `get_queryset()` — see the module-level note on `ledger()`.
    """
    season_q = Q(shipment__season=season)
    if not season.is_closed:
        season_q |= Q(shipment__isnull=True)
    return season_q


def _scope_advances_to_season(qs, season) -> QuerySet:
    """`Exists()`-based season scope for FinansistAdvance.

    FinansistAdvance has no `shipment` FK of its own — only through the
    FinansistAdvanceShipment junction (zero to many links) — and callers that
    need this (`FinansistAdvanceViewSet.get_queryset()`'s `Count`/`Sum`
    annotations, `CustomsExpenseViewSet.ledger()`'s money-in aggregation) both
    need the join-avoiding `Exists()` approach, not a plain filter. An advance
    with zero links plays "unlinked" and surfaces alongside an open season.
    """
    in_season = Exists(
        FinansistAdvanceShipment.objects.filter(
            advance_id=OuterRef('pk'), shipment__season=season,
        )
    )
    if season.is_closed:
        return qs.filter(in_season)
    no_links = ~Exists(
        FinansistAdvanceShipment.objects.filter(advance_id=OuterRef('pk'))
    )
    return qs.filter(Q(in_season) | Q(no_links))


class FinansistAdvanceViewSet(ModelViewSet):
    """
    GET    /api/v1/export/advances/                               — list all advances
    GET    /api/v1/export/advances/{id}/                          — detail with linked shipments
    POST   /api/v1/export/advances/                               — create new advance (finansist)
    PATCH  /api/v1/export/advances/{id}/reconcile/                — mark as reconciled
    POST   /api/v1/export/advances/{id}/link-shipment/            — link a shipment to this advance
    DELETE /api/v1/export/advances/{id}/unlink-shipment/{sid}/    — remove a shipment link

    FinansistAdvance has no `shipment` FK of its own — it reaches shipments
    (zero to many) only through the FinansistAdvanceShipment junction, and the
    queryset already carries `Count('shipment_links')` /
    `Sum('shipment_links__allocated_amount')` annotations. A plain
    `shipment_links__shipment__season=season` filter would add a second join on
    that same multi-valued relation and corrupt those aggregates (rows
    multiplied per matching link). `Exists()` avoids the join entirely, so list
    scoping is hand-rolled here instead of via SeasonScopedMixin. An advance
    with no shipment links at all plays the role of "unlinked" and surfaces
    alongside an open season, same rule as the nullable-shipment models.
    Detail routes and the link/reconcile actions bypass scoping — Rule A.

    Write freeze (D1): `SeasonNotClosed` covers every write that reaches
    `get_object()` — the generic PATCH/DELETE, `reconcile`, and both link
    actions — because `FinansistAdvance.freeze_season` derives the same
    junction anchor for the freeze that `_scope_advances_to_season()` derives
    for reads. `create()` cannot reach layer 1 at all and carries its own
    `assert_bulk_seasons_open()` over the shipments named in the body.
    """

    resource_code = 'advance'
    permission_classes = [IsAuthenticated, DynamicResourcePermission, SeasonNotClosed]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    queryset = (
        FinansistAdvance.objects
        .select_related('issued_by')
        .annotate(
            shipment_count_ann=Count('shipment_links'),
            allocated_total_ann=Coalesce(
                Sum('shipment_links__allocated_amount'),
                Decimal('0'),
                output_field=DecimalField(),
            ),
        )
        .order_by('-advance_date', '-id')
    )

    filterset_fields = ['reconciled', 'currency']
    search_fields = ['batch_code', 'purpose']

    def get_queryset(self):
        qs = super().get_queryset()
        # Prefetch shipment links only for detail/action views (not needed for list).
        if self.action in ('retrieve', 'link_shipment', 'unlink_shipment', 'reconcile'):
            qs = qs.prefetch_related('shipment_links__shipment')

        if self.action == 'list':
            season = resolve_season(self.request)
            if season is None:
                return qs.none()
            qs = _scope_advances_to_season(qs, season)

        return qs

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return FinansistAdvanceDetailSerializer
        if self.action in ('link_shipment', 'unlink_shipment', 'reconcile'):
            return FinansistAdvanceDetailSerializer
        return FinansistAdvanceListSerializer

    @idempotent
    def create(self, request, *args, **kwargs):
        """Create a new advance and optionally link shipments in one transaction.

        Role-gated: finansist and privileged roles only.
        """
        role = getattr(request.user, 'role', None)
        if role not in _ADVANCE_WRITE_ROLES:
            return Response(
                {'error': f"Role '{role}' cannot create advances."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = FinansistAdvanceCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        shipment_ids: list[int] = data.pop('shipment_ids', [])

        # Write freeze (D1). `create()` is fully overridden — it never calls
        # get_object() and never calls perform_create() — so neither layer 1
        # (SeasonNotClosed) nor assert_create_target_open() can fire here.
        # The season lives on the shipments named in the body, exactly the
        # shape `link_shipment` guards below, so this is the only check that
        # can see it.
        #
        # Guarded BEFORE the advance row is written, not just before
        # bulk_create: ATOMIC_REQUESTS is not enabled on this project, so a
        # 409 raised after FinansistAdvance.objects.create() would leave a
        # link-less advance behind — which `_scope_advances_to_season()`
        # treats as "unlinked" and therefore surfaces in the season list and
        # in /ledger/'s advances_total. Same harm, different route.
        if shipment_ids:
            assert_bulk_seasons_open(Shipment.objects.filter(id__in=shipment_ids))

        # Map empty strings to None so optional Cyrillic fields aren't stored as ''
        cleaned = {
            k: (None if v == '' else v)
            for k, v in data.items()
        }
        advance = FinansistAdvance.objects.create(
            issued_by=request.user,
            **cleaned,
        )

        if shipment_ids:
            links = [
                FinansistAdvanceShipment(advance=advance, shipment_id=sid)
                for sid in shipment_ids
            ]
            FinansistAdvanceShipment.objects.bulk_create(links, batch_size=500)

        advance.refresh_from_db()
        detail_serializer = FinansistAdvanceDetailSerializer(advance)
        return Response(detail_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['patch'], url_path='reconcile')
    def reconcile(self, request, pk=None):
        """Mark an advance as reconciled.

        Role-gated: finansist and privileged roles only.
        Idempotent — safe to call on an already-reconciled advance.
        """
        role = getattr(request.user, 'role', None)
        if role not in _ADVANCE_WRITE_ROLES:
            return Response(
                {'error': f"Role '{role}' cannot reconcile advances."},
                status=status.HTTP_403_FORBIDDEN,
            )

        advance: FinansistAdvance = self.get_object()
        if not advance.reconciled:
            advance.reconciled = True
            advance.reconciled_at = timezone.now()
            advance.save(update_fields=['reconciled', 'reconciled_at'])
            logger.info(
                "Advance id=%d reconciled by user=%s", advance.id, request.user.username
            )

        serializer = FinansistAdvanceDetailSerializer(advance)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='link-shipment')
    def link_shipment(self, request, pk=None):
        """Link a shipment to this advance.

        Body: { "shipment_id": 123, "allocated_amount": 1500.00 }
        Enforces the unique constraint — returns 400 if already linked.
        Role-gated: finansist and privileged roles only.
        """
        role = getattr(request.user, 'role', None)
        if role not in _ADVANCE_WRITE_ROLES:
            return Response(
                {'error': f"Role '{role}' cannot modify advance shipment links."},
                status=status.HTTP_403_FORBIDDEN,
            )

        advance: FinansistAdvance = self.get_object()

        shipment_id = request.data.get('shipment_id')
        allocated_amount = request.data.get('allocated_amount')

        if not shipment_id:
            return Response(
                {'error': 'shipment_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target = Shipment.objects.filter(id=shipment_id).select_related('season').first()
        if target is None:
            return Response(
                {'error': f'Shipment {shipment_id} not found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Write freeze (D1), layer 2. `get_object()` above already refused if
        # the ADVANCE is frozen (any existing link in a closed season); this
        # covers the other direction — the season of the shipment named in
        # the body, which no object permission can see.
        assert_season_open(target.season)

        if FinansistAdvanceShipment.objects.filter(
            advance=advance, shipment_id=shipment_id
        ).exists():
            return Response(
                {'error': f'Shipment {shipment_id} is already linked to this advance.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        FinansistAdvanceShipment.objects.create(
            advance=advance,
            shipment_id=shipment_id,
            allocated_amount=allocated_amount or None,
        )

        advance.refresh_from_db()
        serializer = FinansistAdvanceDetailSerializer(advance)
        return Response(serializer.data)

    @action(
        detail=True,
        methods=['delete'],
        url_path=r'unlink-shipment/(?P<shipment_id>[0-9]+)',
    )
    def unlink_shipment(self, request, pk=None, shipment_id=None):
        """Remove a shipment link from this advance.

        Returns 404 if the link does not exist.
        Role-gated: finansist and privileged roles only.
        """
        role = getattr(request.user, 'role', None)
        if role not in _ADVANCE_WRITE_ROLES:
            return Response(
                {'error': f"Role '{role}' cannot modify advance shipment links."},
                status=status.HTTP_403_FORBIDDEN,
            )

        advance: FinansistAdvance = self.get_object()

        # Write freeze (D1), layer 2 — now SUBSUMED by layer 1, kept
        # deliberately. `get_object()` above 409s whenever ANY of the
        # advance's links is in a closed season, which includes this one, so
        # this assert can no longer fire. It stays because layer 2 is
        # specified to hold the invariant independently of layer 1 (spec §5)
        # and this is a finance surface — but read it as belt-and-braces, not
        # as the guard that makes unlink safe.
        link = FinansistAdvanceShipment.objects.filter(
            advance=advance, shipment_id=shipment_id,
        ).select_related('shipment__season').first()
        if link is not None:
            assert_season_open(link.shipment.season)

        deleted_count, _ = FinansistAdvanceShipment.objects.filter(
            advance=advance, shipment_id=shipment_id
        ).delete()

        if deleted_count == 0:
            return Response(
                {'error': f'Shipment {shipment_id} is not linked to this advance.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        advance.refresh_from_db()
        serializer = FinansistAdvanceDetailSerializer(advance)
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# Customs/Document Cash-Advance Ledger (money-OUT side)
# ---------------------------------------------------------------------------

# Roles that may create/update/delete customs expenses.
# Extends finansist+admin+director with document_team and export_manager who
# also process day-to-day clearance fees at the border.
CUSTOMS_EXPENSE_WRITE: frozenset[str] = ADVANCE_WRITE | frozenset({'document_team', 'export_manager'})


class CustomsExpenseViewSet(SeasonScopedMixin, ModelViewSet):
    """CRUD + ledger summary for the customs/document cash-advance ledger.

    Money-OUT side of the float ledger Hangeldi maintains.  Money-IN is tracked
    by ``FinansistAdvance`` (unchanged).  Currency is TMT (Turkmen manat) by default.

    GET    /api/v1/export/customs-expenses/                   — paginated list
    POST   /api/v1/export/customs-expenses/                   — create expense
    GET    /api/v1/export/customs-expenses/{id}/              — detail
    PATCH  /api/v1/export/customs-expenses/{id}/              — partial update
    DELETE /api/v1/export/customs-expenses/{id}/              — delete
    GET    /api/v1/export/customs-expenses/ledger/            — cash-float summary
             (season-scoped independently of get_queryset() — it builds its
             own querysets, so it resolves the season itself and scopes both
             sides via the module-level `_customs_expense_season_q()` /
             `_scope_advances_to_season()` helpers; see `ledger()`)

    List is scoped to the resolved season via `shipment`. CustomsExpense.shipment
    is nullable ("null for batch fees") — `include_null_link` keeps those
    visible whenever the resolved season is open, and hides them the moment a
    closed season is explicitly browsed. Detail routes bypass scoping — Rule A.
    """

    permission_classes = [IsAuthenticated, SeasonNotClosed]
    serializer_class = CustomsExpenseSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']
    season_field = 'shipment__season'
    include_null_link = True

    # Filtering — rely on DEFAULT_FILTER_BACKENDS (DjangoFilterBackend + SearchFilter)
    # so both filterset_fields and search_fields work together (matching the sibling
    # FinansistAdvanceViewSet which also omits filter_backends for the same reason).
    filterset_fields = ['category', 'currency', 'shipment']
    search_fields = ['export_code_raw', 'vehicle_plate', 'route_label', 'label_raw']

    def get_queryset(self):
        """Return expenses with optional date-range window applied.

        Supports query params:
            date_from (YYYY-MM-DD) — earliest expense_date inclusive
            date_to   (YYYY-MM-DD) — latest expense_date inclusive
        """
        qs = (
            CustomsExpense.objects
            .select_related('shipment', 'created_by')
            .order_by('-expense_date', '-id')
        )

        params = self.request.query_params
        date_from_str = params.get('date_from')
        date_to_str = params.get('date_to')

        if date_from_str:
            try:
                qs = qs.filter(expense_date__gte=_date.fromisoformat(date_from_str))
            except ValueError:
                pass  # Silently ignore malformed dates; caller sees unfiltered results.

        if date_to_str:
            try:
                qs = qs.filter(expense_date__lte=_date.fromisoformat(date_to_str))
            except ValueError:
                pass

        if self.action == 'list':
            # ?shipment=<id> (applied later by DjangoFilterBackend via
            # filterset_fields) pins the request to one shipment's own
            # expenses panel. resolve_season() still runs unconditionally so
            # the gap fails closed and a bad/closed ?season= still 404s/403s
            # — see CommentViewSet.get_queryset() for the full rationale.
            season = resolve_season(self.request)
            shipment_id = params.get('shipment')
            if shipment_id and season is not None and can_view_closed(self.request.user):
                pass
            else:
                qs = self.apply_season_scope(qs, season=season)

        return qs

    def _is_write_allowed(self, request) -> bool:
        """Return True if the requesting user may create/edit/delete an expense."""
        role = getattr(request.user, 'role', None)
        return role in CUSTOMS_EXPENSE_WRITE or request.user.is_superuser

    @idempotent
    def create(self, request, *args, **kwargs):
        """Create a new customs expense.  Role-gated: CUSTOMS_EXPENSE_WRITE only."""
        if not self._is_write_allowed(request):
            role = getattr(request.user, 'role', None)
            return Response(
                {'error': f"Role '{role}' cannot create customs expenses."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        """Full update — not exposed (PUT excluded from http_method_names); kept for ModelViewSet compat."""
        if not self._is_write_allowed(request):
            role = getattr(request.user, 'role', None)
            return Response(
                {'error': f"Role '{role}' cannot update customs expenses."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        """Partial-update (PATCH) a customs expense.  Role-gated."""
        if not self._is_write_allowed(request):
            role = getattr(request.user, 'role', None)
            return Response(
                {'error': f"Role '{role}' cannot update customs expenses."},
                status=status.HTTP_403_FORBIDDEN,
            )
        kwargs['partial'] = True
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """Delete a customs expense.  Role-gated."""
        if not self._is_write_allowed(request):
            role = getattr(request.user, 'role', None)
            return Response(
                {'error': f"Role '{role}' cannot delete customs expenses."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    def perform_update(self, serializer) -> None:
        """Save an edit, refusing one that moves the row into a closed season."""
        # Write freeze (D1): layer 1 checked the anchor the row has BEFORE
        # the write; this checks the one it would have AFTER, so a PATCH
        # cannot move the row into a closed season.
        self.assert_update_target_open(serializer)
        serializer.save()

    def perform_create(self, serializer) -> None:
        """Inject created_by from the authenticated user on every create."""
        # Write freeze (D1): CreateModelMixin never calls get_object(), so
        # the SeasonNotClosed object permission cannot fire on a create.
        self.assert_create_target_open(serializer)
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['get'], url_path='ledger')
    def ledger(self, request):
        """Cash-float ledger summary: advances (money-in) vs expenses (money-out).

        Supports the same date_from / date_to query params as the list endpoint.
        All aggregation is performed in the DB — no Python loops over querysets.

        Response shape:
        {
            "currency": "TMT",
            "advances_total": "12500.00",
            "expenses_total": "9800.00",
            "balance": "2700.00",
            "by_category": [
                {"category": "GUMRUKLEME",
                 "category_display": "Customs clearance (per truck)",
                 "total": "5000.00",
                 "count": 10}
            ],
            "by_date": [
                {"date": "2026-06-01", "advances": "2500.00", "expenses": "1200.00"}
            ]
        }

        Season-scoped like every other list on this and the sibling
        FinansistAdvanceViewSet — this action builds its own querysets
        straight off the managers rather than through get_queryset(), so it
        needs its own season resolution rather than inheriting one. Fails
        closed (all-zero response) during the close→open gap; ?season=<id>
        follows the same NotFound/PermissionDenied rules as every scoped list.
        """
        params = request.query_params
        date_from_str = params.get('date_from')
        date_to_str = params.get('date_to')
        # Advances (FinansistAdvance) default to USD while customs expenses default
        # to TMT — summing across currencies would be meaningless. Scope BOTH sides
        # to a single currency so the balance is a valid same-unit figure. Rows in
        # other currencies are excluded from this ledger window.
        currency = params.get('currency') or 'TMT'

        # resolve_season() is called unconditionally, before the date-window
        # parsing below, so a bad/closed ?season= still 404s/403s the same
        # way it would on the plain list endpoint. During the close→open gap
        # (season is None) there is no season to attribute this money to, so
        # the ledger fails closed rather than mixing every season's cash.
        season = resolve_season(request)
        if season is None:
            return Response({
                'currency': currency, 'advances_total': '0', 'expenses_total': '0',
                'balance': '0', 'by_category': [], 'by_date': [],
            })

        # Parse date bounds defensively — return 400 on clearly invalid input.
        date_from: _date | None = None
        date_to: _date | None = None
        if date_from_str:
            try:
                date_from = _date.fromisoformat(date_from_str)
            except ValueError:
                return Response(
                    {'error': f'Invalid date_from: {date_from_str!r}. Use YYYY-MM-DD.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        if date_to_str:
            try:
                date_to = _date.fromisoformat(date_to_str)
            except ValueError:
                return Response(
                    {'error': f'Invalid date_to: {date_to_str!r}. Use YYYY-MM-DD.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # ── Expenses (money-out) ──────────────────────────────────────────────
        expense_qs = CustomsExpense.objects.filter(
            _customs_expense_season_q(season), currency=currency,
        )
        if date_from:
            expense_qs = expense_qs.filter(expense_date__gte=date_from)
        if date_to:
            expense_qs = expense_qs.filter(expense_date__lte=date_to)

        expenses_total: Decimal = expense_qs.aggregate(
            total=Coalesce(Sum('amount'), Decimal('0'), output_field=DecimalField())
        )['total']

        # By category — aggregated in SQL; label mapped in Python from choices dict.
        _category_labels: dict[str, str] = dict(CustomsExpenseCategory.choices)
        by_category_raw = (
            expense_qs
            .values('category')
            .annotate(total=Sum('amount'), count=Count('id'))
            .order_by('-total')
        )
        by_category = [
            {
                'category': row['category'],
                'category_display': _category_labels.get(row['category'], row['category']),
                'total': str(row['total']),
                'count': row['count'],
            }
            for row in by_category_raw
        ]

        # By date — expenses aggregated per day.
        by_expense_date: dict[_date, Decimal] = {
            row['expense_date']: row['day_total']
            for row in (
                expense_qs
                .values('expense_date')
                .annotate(day_total=Sum('amount'))
                .order_by('expense_date')
            )
        }

        # ── Advances (money-in) ───────────────────────────────────────────────
        advance_qs = _scope_advances_to_season(
            FinansistAdvance.objects.filter(currency=currency), season,
        )
        if date_from:
            advance_qs = advance_qs.filter(advance_date__gte=date_from)
        if date_to:
            advance_qs = advance_qs.filter(advance_date__lte=date_to)

        advances_total: Decimal = advance_qs.aggregate(
            total=Coalesce(Sum('total_amount'), Decimal('0'), output_field=DecimalField())
        )['total']

        # By date — advances aggregated per day.
        by_advance_date: dict[_date, Decimal] = {
            row['advance_date']: row['day_total']
            for row in (
                advance_qs
                .values('advance_date')
                .annotate(day_total=Sum('total_amount'))
                .order_by('advance_date')
            )
        }

        # ── Merge by_date — union of all dates that appear in either side ─────
        all_dates = sorted(by_advance_date.keys() | by_expense_date.keys())
        by_date = [
            {
                'date': str(d),
                'advances': str(by_advance_date.get(d, Decimal('0'))),
                'expenses': str(by_expense_date.get(d, Decimal('0'))),
            }
            for d in all_dates
        ]

        balance: Decimal = advances_total - expenses_total

        return Response({
            'currency': currency,
            'advances_total': str(advances_total),
            'expenses_total': str(expenses_total),
            'balance': str(balance),
            'by_category': by_category,
            'by_date': by_date,
        })
