import datetime
import logging
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import write_permission, DynamicResourcePermission, SeasonNotClosed
from apps.core.roles import LOCAL_SELL_APPROVE, LOCAL_SELL_WRITE, PRICE_WRITE, TRUCK_WRITE
from apps.core.seasons import (
    SeasonScopedMixin,
    assert_bulk_seasons_open,
    assert_season_id_open,
    assert_season_open,
    get_active_season,
)
from apps.export.models import (
    LOCAL_SELL_DAY_FIELDS,
    WeeklyLocalSellPlan,
    WeeklyTruckAllocation,
    TruckDestinationSplit,
    WeeklyDestinationSelection,
    PriceEntry,
)
from apps.export.serializers_planning import (
    WeeklyLocalSellPlanSerializer,
    WeeklyTruckAllocationSerializer,
    WeeklyDestinationSelectionSerializer,
    PriceEntrySerializer,
)
from apps.export.services import (
    submit_local_sell_plan,
    approve_local_sell_plan,
    reject_local_sell_plan,
    generate_local_sell_plan_tasks,
)

logger = logging.getLogger(__name__)

_TRUCK_WRITE_ROLES = TRUCK_WRITE
_PRICE_WRITE_ROLES = PRICE_WRITE


class PriceEntryViewSet(ModelViewSet):
    """
    GET   /api/v1/export/prices/          — list (filter by ?city=&days=7)
    POST  /api/v1/export/prices/          — create new price entry
    """

    resource_code = 'price_entry'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
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


class WeeklyTruckAllocationViewSet(SeasonScopedMixin, ModelViewSet):
    """
    GET    /api/v1/export/truck-allocations/        — list (filter ?season=&year=&week_number=)
    POST   /api/v1/export/truck-allocations/        — create; auto-computes total_trucks_calc
    PUT    /api/v1/export/truck-allocations/{id}/   — full update; recomputes total_trucks_calc
    PATCH  /api/v1/export/truck-allocations/{id}/   — partial update; recomputes if kg changed
    """

    resource_code = 'truck_allocation'
    permission_classes = [IsAuthenticated, DynamicResourcePermission, SeasonNotClosed]
    serializer_class = WeeklyTruckAllocationSerializer
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']
    # `season` is not a filterset field — DRF runs the filter backends inside
    # get_object() too, so a detail request carrying ?season= would 404 a row
    # from another season. Season scoping lives in get_queryset() below, where
    # resolve_season() also enforces the closed-season permission.
    filterset_fields = ['year', 'week_number']

    queryset = WeeklyTruckAllocation.objects.select_related(
        'season', 'decided_by',
    ).prefetch_related(
        'destination_splits__destination',
    ).order_by('year', 'week_number', 'day_of_week')

    _TRUCK_CAPACITY_KG = Decimal('18500')

    def get_queryset(self):
        qs = super().get_queryset()
        if getattr(self, 'action', None) == 'list':
            qs = self.apply_season_scope(qs)
        return qs

    def _compute_trucks_calc(self, total_planned_kg) -> Decimal | None:
        """Compute total_trucks_calc = total_planned_kg / 18500, rounded to 2 dp."""
        if total_planned_kg is None:
            return None
        return (Decimal(str(total_planned_kg)) / self._TRUCK_CAPACITY_KG).quantize(Decimal('0.01'))

    def perform_create(self, serializer):
        # Write freeze (D1): CreateModelMixin never calls get_object(), so
        # the SeasonNotClosed object permission cannot fire on a create.
        self.assert_create_target_open(serializer)
        planned_kg = serializer.validated_data.get('total_planned_kg')
        serializer.save(
            decided_by=self.request.user,
            total_trucks_calc=self._compute_trucks_calc(planned_kg),
        )

    def perform_update(self, serializer):
        # Write freeze (D1): layer 1 checked the anchor the row has BEFORE
        # the write; this checks the one it would have AFTER, so a PATCH
        # cannot move the row into a closed season.
        self.assert_update_target_open(serializer)
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

        allocation.refresh_from_db()
        serializer = self.get_serializer(
            WeeklyTruckAllocation.objects.prefetch_related(
                'destination_splits__destination',
            ).get(pk=allocation.pk)
        )
        return Response(serializer.data)


class WeeklyDestinationSelectionViewSet(SeasonScopedMixin, ModelViewSet):
    """
    GET   /api/v1/export/truck-destination-selections/       — list (filter ?season=&year=&week_number=)
    POST  /api/v1/export/truck-destination-selections/set/   — replace a week's selected destinations

    Persists which destinations appear as rows in a week's truck-allocation grid.
    When a week has no rows, the frontend falls back to TruckDestination.is_default.
    """

    resource_code = 'truck_allocation'
    permission_classes = [IsAuthenticated, DynamicResourcePermission, SeasonNotClosed]
    serializer_class = WeeklyDestinationSelectionSerializer
    http_method_names = ['get', 'post', 'head', 'options']
    # See WeeklyTruckAllocationViewSet: season scoping lives in get_queryset(),
    # not in the filterset, so detail routes stay resolvable.
    filterset_fields = ['year', 'week_number']

    queryset = WeeklyDestinationSelection.objects.select_related(
        'destination',
    ).order_by('destination__sort_order')

    def perform_create(self, serializer):
        # Write freeze (D1): CreateModelMixin never calls get_object(), so
        # the SeasonNotClosed object permission cannot fire on a create.
        self.assert_create_target_open(serializer)
        serializer.save()

    def get_queryset(self):
        qs = super().get_queryset()
        if getattr(self, 'action', None) == 'list':
            qs = self.apply_season_scope(qs)
        return qs

    @action(detail=False, methods=['post'], url_path='set')
    def set_selection(self, request):
        """POST /api/v1/export/truck-destination-selections/set/

        Body: { "season": 3, "year": 2026, "week_number": 22, "destination_ids": [1, 2, 3] }
        Replaces the full set of selected destinations for that week.
        """
        season = request.data.get('season')
        year = request.data.get('year')
        week_number = request.data.get('week_number')
        destination_ids = request.data.get('destination_ids', [])

        if not all([season, year, week_number]):
            return Response(
                {'error': 'season, year and week_number are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(destination_ids, list):
            return Response(
                {'error': 'destination_ids must be a list.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        # Write freeze (D1). The season arrives in the BODY here, so neither
        # layer 1 (no get_object()) nor a queryset check can see it.
        assert_season_id_open(season)

        scope = {'season_id': season, 'year': year, 'week_number': week_number}
        WeeklyDestinationSelection.objects.filter(**scope).delete()
        WeeklyDestinationSelection.objects.bulk_create(
            [
                WeeklyDestinationSelection(destination_id=dest_id, **scope)
                for dest_id in dict.fromkeys(destination_ids)  # de-dup, preserve order
            ],
            batch_size=500,
        )

        rows = WeeklyDestinationSelection.objects.filter(**scope).select_related('destination')
        return Response(self.get_serializer(rows, many=True).data)


# ---------------------------------------------------------------------------
# Weekly Local Sell Plan
# ---------------------------------------------------------------------------

_LOCAL_SELL_WRITE_ROLES = LOCAL_SELL_WRITE
_LOCAL_SELL_APPROVE_ROLES = LOCAL_SELL_APPROVE
_SELL_PLAN_DAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')


class LocalSellPlanLocked(APIException):
    """409 — the write is refused by the plan's own lock, not by the payload.

    409 rather than DRF's 400 ValidationError because nothing is wrong with
    what was sent: the row's state forbids it. It also puts the lock in the
    same family as the closed-season guard, which the grid already handles.
    The bodies stay distinguishable by their `error` key —
    `plan_approved_locked` / `cell_locked_after_submit` here vs core's
    `season_closed` — so the UI can name the right reason and the right person
    to ask.
    """

    status_code = http_status.HTTP_409_CONFLICT


class WeeklyLocalSellPlanViewSet(SeasonScopedMixin, ModelViewSet):
    """
    GET    /api/v1/export/local-sell-plans/             — list (filter ?export_firm=&year=&week=)
    POST   /api/v1/export/local-sell-plans/             — create
    PUT    /api/v1/export/local-sell-plans/{id}/        — update
    POST   .../submit/, approve/, reject/               — workflow actions
    POST   .../initialize-week/                         — create rows for all active firms
    """

    resource_code = 'local_sell_plan'
    permission_classes = [IsAuthenticated, DynamicResourcePermission, SeasonNotClosed]
    serializer_class = WeeklyLocalSellPlanSerializer
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']

    queryset = WeeklyLocalSellPlan.objects.select_related(
        'season', 'export_firm', 'entered_by',
        'submitted_by', 'approved_by', 'rejected_by',
    ).order_by('year', 'week_number', 'export_firm__name_en')

    def get_queryset(self):
        qs = super().get_queryset()
        if getattr(self, 'action', None) == 'list':
            qs = self.apply_season_scope(qs)
        params = self.request.query_params
        if firm := params.get('export_firm'):
            qs = qs.filter(export_firm_id=firm)
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if week := params.get('week'):
            qs = qs.filter(week_number=week)
        return qs

    def perform_create(self, serializer):
        role = getattr(self.request.user, 'role', None)
        if role not in _LOCAL_SELL_WRITE_ROLES:
            raise PermissionDenied('Only export_manager/director/seller can create local sell plans.')
        # WeeklyLocalSellPlan.season is nullable and the serializer does not
        # require it. Now that the list is season-scoped, a NULL-season row
        # would be invisible the moment it is created, so stamp the write
        # target — the same default ContractCreateSerializer already applies.
        season = serializer.validated_data.get('season') or get_active_season()
        # Write freeze (D1) — the body may name a closed season;
        # get_active_season() never can.
        assert_season_open(season)
        serializer.save(entered_by=self.request.user, season=season)

    def perform_update(self, serializer):
        """PATCH one cell: check the lock, save, then auto-submit the week.

        The grid autosaves on blur and has no Send button (2026-08-23, owner
        request), so this single method carries three rules that used to be
        spread across a button and two blanket status checks:

        1. An APPROVED plan is frozen for everyone — see
           `WeeklyLocalSellPlan.locked_day_fields`.
        2. A SUBMITTED plan still accepts fills into days that are empty; days
           that already hold a value are locked to the writer and stay
           overridable by an approver.
        3. The first non-zero save on a draft/rejected plan submits it.

        Every lock is decided from the PRE-save instance. Order matters:
        `serializer.save()` mutates `serializer.instance`, so a check made
        afterwards would see the just-filled cell as already-filled and refuse
        exactly the write rule 2 exists to allow.
        """
        # Write freeze (D1): layer 1 checked the anchor the row has BEFORE
        # the write; this checks the one it would have AFTER, so a PATCH
        # cannot move the row into a closed season.
        self.assert_update_target_open(serializer)
        instance = serializer.instance
        role = getattr(self.request.user, 'role', None)
        is_admin = role in _LOCAL_SELL_APPROVE_ROLES

        # Idea 3 (2026-08-23): approved is final. Unconditional and ahead of any
        # field comparison, so a PATCH of `export_firm` or `week_number` is
        # refused too — not just the six day columns.
        if instance.status == 'approved':
            raise LocalSellPlanLocked({
                'error': 'plan_approved_locked',
                'message': (
                    f'W{instance.week_number}/{instance.year} is approved — '
                    f'approved plans are locked for everyone.'
                ),
            })

        locked = instance.locked_day_fields(is_approver=is_admin)
        blocked = [f for f in serializer.validated_data if f in locked]
        if blocked:
            raise LocalSellPlanLocked({
                'error': 'cell_locked_after_submit',
                'fields': blocked,
                'message': (
                    'Already sent for approval — only days still empty can be '
                    'filled. Ask an export manager to change a day that is '
                    'already entered.'
                ),
            })

        if role not in _LOCAL_SELL_WRITE_ROLES:
            raise PermissionDenied(f"Role '{role}' cannot edit local sell plans.")

        # Audit every edit landing on a submitted plan — the approver's
        # override AND the writer's fill-empties. `approved` is unreachable
        # here now (it raised above), so `submitted` is the whole set.
        if instance.status == 'submitted':
            from apps.export.models import AuditLog
            changed = serializer.validated_data
            detail_parts = []
            for field, new_val in changed.items():
                old_val = getattr(instance, field, None)
                if old_val != new_val:
                    detail_parts.append(f'{field}: {old_val} -> {new_val}')
            if detail_parts:
                AuditLog.objects.create(
                    user=self.request.user,
                    action='local_sell_edit',
                    model_name='WeeklyLocalSellPlan',
                    object_id=instance.id,
                    object_repr=str(instance),
                    detail='; '.join(detail_parts),
                )

        with transaction.atomic():
            serializer.save(entered_by=self.request.user)
            # Auto-submit replaces the removed Send button. Guarded on a
            # positive day because `submit_local_sell_plan` raises ValueError
            # without one: an all-zero save ("nothing to sell this week") must
            # stay a draft, which is also what `_week_is_complete` expects.
            plan = serializer.instance
            if plan.status in ('draft', 'rejected') and any(
                getattr(plan, f) > 0 for f in LOCAL_SELL_DAY_FIELDS
            ):
                submit_local_sell_plan(plan, self.request.user)

    # --- Workflow actions (delegated to services.py) ---

    @action(detail=True, methods=['post'], url_path='submit')
    def submit(self, request, pk=None):
        plan = self.get_object()
        try:
            submit_local_sell_plan(plan, request.user)
        except (ValueError, PermissionError) as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(plan).data)

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        plan = self.get_object()
        role = getattr(request.user, 'role', None)
        if role not in _LOCAL_SELL_APPROVE_ROLES:
            raise PermissionDenied('Only export_manager/director can approve.')
        try:
            approve_local_sell_plan(plan, request.user)
        except (ValueError, PermissionError) as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(plan).data)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        plan = self.get_object()
        role = getattr(request.user, 'role', None)
        if role not in _LOCAL_SELL_APPROVE_ROLES:
            raise PermissionDenied('Only export_manager/director can reject.')
        rejection_note = request.data.get('rejection_note', '')
        try:
            reject_local_sell_plan(plan, request.user, rejection_note)
        except (ValueError, PermissionError) as exc:
            return Response({'error': str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(plan).data)

    @action(detail=False, methods=['post'], url_path='bulk-submit')
    def bulk_submit(self, request):
        role = getattr(request.user, 'role', None)
        if role not in _LOCAL_SELL_WRITE_ROLES:
            raise PermissionDenied('Only export_manager/director/seller can submit.')
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'error': 'ids list is required.'}, status=http_status.HTTP_400_BAD_REQUEST)
        plans = WeeklyLocalSellPlan.objects.filter(id__in=ids, status__in=['draft', 'rejected'])
        # Write freeze (D1) — bulk by raw id list, no get_object().
        assert_bulk_seasons_open(plans)
        submitted_ids, errors = [], []
        for plan in plans:
            try:
                submit_local_sell_plan(plan, request.user)
                submitted_ids.append(plan.id)
            except (ValueError, PermissionError) as exc:
                errors.append({'id': plan.id, 'error': str(exc)})
        return Response({'submitted': submitted_ids, 'errors': errors})

    @action(detail=False, methods=['post'], url_path='bulk-approve')
    def bulk_approve(self, request):
        role = getattr(request.user, 'role', None)
        if role not in _LOCAL_SELL_APPROVE_ROLES:
            raise PermissionDenied('Only export_manager/director can approve.')
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'error': 'ids list is required.'}, status=http_status.HTTP_400_BAD_REQUEST)
        plans = WeeklyLocalSellPlan.objects.filter(id__in=ids, status='submitted')
        # Write freeze (D1) — bulk by raw id list, no get_object().
        assert_bulk_seasons_open(plans)
        approved_ids, errors = [], []
        for plan in plans:
            try:
                approve_local_sell_plan(plan, request.user)
                approved_ids.append(plan.id)
            except (ValueError, PermissionError) as exc:
                errors.append({'id': plan.id, 'error': str(exc)})
        return Response({'approved': approved_ids, 'errors': errors})

    @action(detail=False, methods=['post'], url_path='initialize-week')
    def initialize_week(self, request):
        """Create draft rows for all active export firms for the given week."""
        from apps.core.models import ExportFirm

        week_number = request.data.get('week_number')
        year = request.data.get('year')
        # `season` is optional in the request body (the frontend sends
        # activeSeason?.id, which can be undefined). Fall back to the write
        # target rather than inserting NULL-season rows that the season-scoped
        # list would immediately hide.
        season_id = request.data.get('season')
        if not season_id:
            active_season = get_active_season()
            season_id = active_season.id if active_season else None

        if not all([week_number, year]):
            return Response(
                {'error': 'week_number and year are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        # WRITE, not APPROVE (2026-08-23, owner request): the seller owns the
        # sell plan and must be able to open their own week without waiting for
        # an export_manager. Seeding all-zero draft rows commits to nothing —
        # submit and approve stay on _LOCAL_SELL_APPROVE_ROLES below.
        role = getattr(request.user, 'role', None)
        if role not in _LOCAL_SELL_WRITE_ROLES:
            raise PermissionDenied('Only export_manager/director/seller can initialize a week.')

        # Write freeze (D1). Only the explicit-body branch can be closed —
        # get_active_season() never returns a closed season.
        assert_season_id_open(season_id)

        # The dedupe below is deliberately NOT season-scoped: the table is
        # UNIQUE (export_firm_id, week_number, year) with no season in the key,
        # so an ISO week can physically exist under exactly ONE season. Scoping
        # it would build 25 rows that violate that constraint on bulk_create.
        #
        # Which makes the cross-season case a hard conflict, not a no-op. It
        # used to be silent: `existing_firm_ids` matched rows belonging to
        # ANOTHER season, so nothing was created, and the response (also
        # unscoped) reported every one of those invisible rows back as a 200.
        # The caller saw "initialized 25" and a still-empty, season-scoped
        # grid — the 2026-08-23 report. Say so instead.
        clashing = WeeklyLocalSellPlan.objects.filter(
            week_number=week_number, year=year,
        ).exclude(season_id=season_id)
        if clashing.exists():
            other = clashing.select_related('season').first().season
            return Response(
                {
                    'error': 'week_exists_in_other_season',
                    'season': other.name if other else None,
                    'count': clashing.count(),
                },
                status=http_status.HTTP_409_CONFLICT,
            )

        active_firms = ExportFirm.objects.filter(is_active=True)
        existing_firm_ids = set(
            WeeklyLocalSellPlan.objects.filter(
                week_number=week_number, year=year,
            ).values_list('export_firm_id', flat=True)
        )

        new_plans = [
            WeeklyLocalSellPlan(
                export_firm=firm,
                week_number=week_number,
                year=year,
                season_id=season_id,
                entered_by=request.user,
            )
            for firm in active_firms
            if firm.id not in existing_firm_ids
        ]

        if new_plans:
            WeeklyLocalSellPlan.objects.bulk_create(new_plans, batch_size=500)

        # Create the shared seller reminder task for this week (idempotent).
        generate_local_sell_plan_tasks(int(year), int(week_number), user=request.user)

        # Scoped to the season written, so `count` describes what the caller's
        # own season-scoped list will show — not a superset it cannot see.
        qs = WeeklyLocalSellPlan.objects.filter(
            week_number=week_number, year=year, season_id=season_id,
        ).select_related('season', 'export_firm', 'entered_by', 'submitted_by', 'approved_by', 'rejected_by')
        serializer = self.get_serializer(qs, many=True)
        return Response({'count': len(serializer.data), 'results': serializer.data})
