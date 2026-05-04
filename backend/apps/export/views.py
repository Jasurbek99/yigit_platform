import logging
from decimal import Decimal

from django.db import transaction
from django.db.models import (
    Count,
    Exists,
    F,
    OuterRef,
    Q,
    QuerySet,
    Subquery,
)
from django.db.models.functions import RowNumber
from django.db.models.expressions import Window
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.core.permission_registry import ROLE_REQUIRED_FIELDS
from apps.core.permissions import (
    PRIVILEGED_ROLES,
    DynamicResourcePermission,
    can_edit_sheet_field,
    get_sheet_edit_map,
)
from apps.export.models import (
    AuditLog,
    FinansistAdvanceShipment,
    Pallet, QualityDocument, QuotaUsageRecord, SalesReport, Shipment, ShipmentComment,
    ShipmentBlockSource, ShipmentFirmSplit, SheetRowSetting, UserSheetRowPref,
    get_default_truck_weight,
)
from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
from apps.export.serializers import (
    PalletBulkUpsertSerializer,
    PalletSerializer,
    QualityDocumentSerializer,
    OverdueShipmentSerializer,
    SalesReportSerializer,
    ShipmentAssignSerializer,
    ShipmentCreateSerializer,
    ShipmentListSerializer,
    ShipmentDetailSerializer,
    ShipmentSheetSerializer,
    CommentSerializer,
    CommentCreateSerializer,
    ShipmentPatchSerializer,
    VarietyOverrideSerializer,
)
from apps.export.services import (
    close_pallet_manifest,
    create_shipment,
    override_dominant_varieties,
    transition_to,
)

logger = logging.getLogger(__name__)

# Status codes for the SALES phase (steps 9-11) — shipments that have arrived
# but haven't reached hasabat yet. Used by the overdue endpoint.
SALES_PHASE_CODES = ['bardy', 'satylyar', 'satyldy']

# Maps user role to shipment status phases visible under "my work" filter.
# Phase values match ShipmentStatusType.phase in the DB.
ROLE_PHASE_MAP = {
    'loading_dept_head': ['LOADING'],  # same window as warehouse_chief
    'warehouse_chief': ['LOADING'],
    'document_team': ['LOADING', 'CUSTOMS'],
    'transport': ['LOADING', 'CUSTOMS', 'TRANSIT', 'BORDER'],
    'sales_rep': ['BORDER', 'TRANSIT', 'SALES'],
    'finansist': ['SALES'],
}


class ShipmentViewSet(ModelViewSet):
    """
    GET    /api/v1/export/shipments/                 — paginated list (all roles)
    GET    /api/v1/export/shipments/?my_work=true    — filtered to role's active window
    GET    /api/v1/export/shipments/{id}/            — full detail
    POST   /api/v1/export/shipments/{id}/transition/ — status transition
    """

    resource_code = 'shipment'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']  # no PUT/DELETE via API

    queryset = Shipment.objects.select_related(
        'status', 'country', 'city', 'customer', 'season',
        'variety', 'border_point',
    ).order_by('-date', '-id')

    filterset_fields = ['status', 'country', 'season', 'is_gapy_satys', 'customer']
    search_fields = ['cargo_code']

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ShipmentDetailSerializer
        return ShipmentListSerializer

    # Roles allowed to view the Archive view (?archived=true). Operational view
    # (the default) is open to everyone with shipment.view permission. Archive
    # is a more sensitive read — closed shipments may include historical buyer
    # prices and other data only management should browse.
    _ARCHIVE_VIEW_ROLES = ('admin', 'director', 'export_manager', 'finansist', 'boss')

    # Roles allowed to view the Stuck dashboard (?stuck=true). Tighter than
    # archive — stuck reveals which roles are dragging on what, which is a
    # management-only signal. Mirrored by ARCHIVE_VIEW_ROLES on the frontend.
    _STUCK_VIEW_ROLES = ('admin', 'director', 'boss')

    # Stuck threshold in days. A shipment is "stuck" if it's still operational
    # (is_archived=False), not yet closed (phase != COMPLETE), and hasn't been
    # touched in N days. 4 matches the lower bound of the dashboard's color
    # scale (4–7 yellow / 8–14 orange / 15+ red).
    _STUCK_THRESHOLD_DAYS = 4

    def get_queryset(self) -> QuerySet:
        from datetime import timedelta
        from django.utils import timezone as _tz

        qs = super().get_queryset()

        # ── Operational vs Archive split (Phase 3, ADR-0005) ─────────────────
        # Default: is_archived=False (operational). ?archived=true opens the
        # archive view, gated to a subset of management roles.
        archived_param = self.request.query_params.get('archived')
        if archived_param == 'true':
            role = getattr(self.request.user, 'role', None)
            is_super = getattr(self.request.user, 'is_superuser', False)
            if not (is_super or role in self._ARCHIVE_VIEW_ROLES):
                # Return an empty queryset; the viewset will paginate as 0 results.
                # Rejecting at queryset level (rather than 403) keeps the error
                # path uniform with other implicit role-based filters here.
                return qs.none()
            qs = qs.filter(is_archived=True)
        else:
            qs = qs.filter(is_archived=False)

        # ── Stuck dashboard (Phase 4a, ADR-0005) ─────────────────────────────
        # ?stuck=true returns operational, not-yet-closed shipments untouched
        # for ≥ _STUCK_THRESHOLD_DAYS days, oldest first. Role-gated to admin/
        # director/boss; other roles silently get an empty page.
        if self.request.query_params.get('stuck') == 'true':
            role = getattr(self.request.user, 'role', None)
            is_super = getattr(self.request.user, 'is_superuser', False)
            if not (is_super or role in self._STUCK_VIEW_ROLES):
                return qs.none()
            cutoff = _tz.now() - timedelta(days=self._STUCK_THRESHOLD_DAYS)
            qs = (
                qs.exclude(status__phase='COMPLETE')
                .filter(updated_at__lte=cutoff)
                .order_by('updated_at', 'id')
            )

        # pending_my_fields takes priority over my_work when both are present.
        if self.request.query_params.get('pending_my_fields') == 'true':
            qs = self._filter_pending_fields(qs)
        elif self.request.query_params.get('my_work') == 'true':
            qs = self._filter_my_work(qs)
        if phase := self.request.query_params.get('phase'):
            qs = qs.filter(status__phase=phase)
        if status_code := self.request.query_params.get('status_code'):
            qs = qs.filter(status__code=status_code)
        # Inclusive date range on Shipment.date.
        if date_after := self.request.query_params.get('date_after'):
            qs = qs.filter(date__gte=date_after)
        if date_before := self.request.query_params.get('date_before'):
            qs = qs.filter(date__lte=date_before)
        # Filter by export firm via firm_splits junction. Use Exists() to avoid
        # duplicate Shipment rows from the join.
        if export_firm := self.request.query_params.get('export_firm'):
            qs = qs.filter(
                Exists(
                    ShipmentFirmSplit.objects.filter(
                        shipment=OuterRef('pk'), export_firm_id=export_firm,
                    )
                )
            )
        # harvest_age_days is computed (not a DB column) but it is monotonic in date:
        # oldest harvest = lowest date = highest age.  Translate to a date sort so
        # MSSQL can use the existing index on shipments.date.
        ordering = self.request.query_params.get('ordering')
        if ordering == 'harvest_age_desc':
            # oldest-first (most aged at top) — intended for Assignment Board
            qs = qs.order_by('date', 'id')
        elif ordering == 'harvest_age_asc':
            # newest-first
            qs = qs.order_by('-date', '-id')
        return qs

    def _filter_my_work(self, qs: QuerySet) -> QuerySet:
        """Restrict to shipments in the current user's role active window.

        All roles can always see all shipments (full list). The my_work filter
        is a UI convenience — it is applied server-side using the phase field
        from ShipmentStatusType.
        """
        role = getattr(self.request.user, 'role', None)
        phases = ROLE_PHASE_MAP.get(role, [])
        if phases:
            return qs.filter(status__phase__in=phases)
        # export_manager and management see everything — no filter
        return qs

    def _filter_pending_fields(self, qs: QuerySet) -> QuerySet:
        """Return shipments in the user's active phases where required fields are still null.

        Uses ROLE_REQUIRED_FIELDS to determine which fields the role must fill.
        A shipment appears if ANY required field is null — i.e. the role's work is incomplete.
        """
        role = getattr(self.request.user, 'role', None)
        required = ROLE_REQUIRED_FIELDS.get(role, [])
        if not required:
            return qs.none()
        # Scope to the role's active phases
        phases = ROLE_PHASE_MAP.get(role, [])
        if phases:
            qs = qs.filter(status__phase__in=phases)
        # Build OR of null checks — shipment needs work if any field is missing
        null_q = Q()
        for field in required:
            null_q |= Q(**{f'{field}__isnull': True})
        return qs.filter(null_q)

    @action(detail=False, methods=['get'], url_path='my-pending-count')
    def my_pending_count(self, request):
        """GET /api/v1/export/shipments/my-pending-count/

        Returns { "count": N } — number of shipments where the user's role
        has required fields still unfilled. Used by the frontend for badge counts.
        """
        base_qs = super().get_queryset()
        qs = self._filter_pending_fields(base_qs)
        return Response({'count': qs.count()})

    def partial_update(self, request, pk=None):
        """PATCH /api/v1/export/shipments/{id}/

        Only fields permitted by the user's role may be included in the body.
        Forbidden fields return 403. Returns updated shipment detail on success.

        Every submitted field whose stored value actually changes is recorded as
        an AuditLog row (field_name, old_value, new_value) inside the same
        transaction as the save, so a save failure rolls back audit rows too.
        """
        from apps.export.services.sheet_audit import diff_audit_rows, snapshot_fields

        shipment = self.get_object()

        # Phase 3 (ADR-0005): archived shipments are read-only by contract.
        # The frontend hides edit controls under isArchiveView, but defend
        # against a crafted PATCH /shipments/{id}/?archived=true that would
        # otherwise pass through get_queryset's archived-view branch.
        if shipment.is_archived:
            return Response(
                {'error': 'Archived shipments are read-only.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        user_role = getattr(request.user, 'role', None)

        serializer = ShipmentPatchSerializer(
            shipment,
            data=request.data,
            partial=True,
            context={'role': user_role, 'request': request},
        )
        if not serializer.is_valid():
            # Check if any error is a role-permission error (403) vs validation (400)
            errors = serializer.errors
            forbidden_fields = [
                f for f, msgs in errors.items()
                if any("cannot edit" in str(m) for m in msgs)
            ]
            if forbidden_fields:
                return Response(
                    {'error': f"Role '{user_role}' cannot edit: {', '.join(forbidden_fields)}"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        # Capture only the fields the user actually submitted.
        submitted_keys = list(serializer.validated_data.keys())
        before = snapshot_fields(shipment, submitted_keys)

        with transaction.atomic():
            serializer.save()
            # Reload from DB so computed fields (auto_now timestamps, DB defaults) are fresh.
            instance = serializer.instance
            instance.refresh_from_db()
            after = snapshot_fields(instance, submitted_keys)

            audit_rows = diff_audit_rows(instance, before, after, request.user)
            if audit_rows:
                AuditLog.objects.bulk_create(audit_rows, batch_size=500)

        detail_serializer = ShipmentDetailSerializer(instance, context={'request': request})
        return Response(detail_serializer.data)

    @action(detail=True, methods=['post'], url_path='transition')
    def transition(self, request, pk=None):
        """POST /api/v1/export/shipments/{id}/transition/

        Request body:
            { "new_status": "gumruk_girish", "comment": "optional" }

        Returns updated shipment detail on success.
        Returns 400 on invalid transition, 403 on permission denied.
        """
        shipment = self.get_object()
        new_status_code = request.data.get('new_status')
        comment = request.data.get('comment', '')

        if not new_status_code:
            return Response(
                {'error': 'new_status is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Role validation and transition sequencing are enforced inside transition_to().
        try:
            transition_to(shipment, new_status_code, request.user, comment)
        except PermissionError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        serializer = ShipmentDetailSerializer(shipment, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='overdue')
    def overdue(self, request):
        """GET /api/v1/export/shipments/overdue/?threshold=N

        Returns shipments stuck in the SALES phase (bardy / satylyar / satyldy,
        steps 9-11) that have not progressed to hasabat within `threshold` days.

        days_overdue is computed in Python as: today − (arrived_at or updated_at).
        MSSQL cannot subtract DATETIMEOFFSET columns natively in Django ORM, so
        we filter SALES-phase shipments (a bounded small set) and compute in Python.

        Query params:
            threshold (int, default 7): minimum days overdue to include.
        """
        allowed_roles = PRIVILEGED_ROLES | {'sales_rep', 'finansist'}
        if getattr(request.user, 'role', None) not in allowed_roles:
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        try:
            threshold = int(request.query_params.get('threshold', 7))
        except (TypeError, ValueError):
            return Response(
                {'error': 'threshold must be an integer'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # has_sales_report: True when a SalesReport row exists for this shipment.
        has_report_expr = Exists(SalesReport.objects.filter(shipment=OuterRef('pk')))

        # Use the base queryset (not self.get_queryset()) to avoid
        # my_work / pending_my_fields filters leaking into the overdue endpoint.
        qs = (
            super().get_queryset()
            .filter(status__code__in=SALES_PHASE_CODES)
            .annotate(has_sales_report=has_report_expr)
        )

        # Compute days_overdue in Python — MSSQL-safe, no DurationField subtraction.
        # SALES-phase shipments are a bounded small set (dozens, not thousands).
        now = timezone.now()
        results = []
        for shipment in qs:
            ref_date = shipment.arrived_at or shipment.updated_at
            if ref_date is None:
                continue
            days = (now - ref_date).days
            if days > threshold:
                shipment.days_overdue = days
                results.append(shipment)

        results.sort(key=lambda s: s.days_overdue, reverse=True)

        page = self.paginate_queryset(results)
        if page is not None:
            serializer = OverdueShipmentSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = OverdueShipmentSerializer(results, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='sheet')
    def sheet(self, request):
        """GET /api/v1/export/shipments/sheet/

        Returns ALL shipments for a season with full sheet fields.
        Accepts an optional ``?season=<id>`` param; defaults to the active season.
        No pagination — the frontend spreadsheet view needs all records at once.

        Applies the same my_work / phase filters as the list endpoint when those
        query params are present, so the sheet can be scoped by role if needed.
        """
        season_filter = {}
        season_id = request.query_params.get('season')
        if season_id:
            season_filter['season_id'] = season_id
        else:
            season_filter['season__is_active'] = True

        qs = (
            Shipment.objects.select_related(
                'status', 'country', 'city', 'customer',
                'import_firm', 'border_point', 'variety',
                'created_by', 'quality',
            )
            .prefetch_related(
                'firm_splits__export_firm',
                'block_sources__block',
            )
            .annotate(
                has_sales_report=Exists(
                    SalesReport.objects.filter(shipment=OuterRef('pk'))
                ),
                # R24 — flag for finansist documentation/customs advance
                has_doc_advance=Exists(
                    FinansistAdvanceShipment.objects.filter(shipment=OuterRef('pk'))
                ),
                warehouse_comment_count=Count(
                    'comments',
                    filter=Q(comments__user__role='warehouse_chief'),
                ),
                document_comment_count=Count(
                    'comments',
                    filter=Q(comments__user__role='document_team'),
                ),
            )
            .filter(**season_filter)
            # Phase 3: the operational Sheet view never shows archived rows.
            # Archive view lives on ShipmentList — no Sheet equivalent.
            .filter(is_archived=False)
            .order_by('-date', '-id')
        )

        serializer = ShipmentSheetSerializer(qs, many=True)
        shipment_data = serializer.data

        # === Per-cell comment counts (single query, grouped in Python — no N+1) ===
        ids = [s.id for s in qs]
        comment_counts: dict[int, dict[str, int]] = {}
        task_counts: dict[int, dict[str, int]] = {}

        if ids:
            raw_comments = (
                ShipmentComment.objects.filter(shipment_id__in=ids, is_deleted=False)
                .values('shipment_id', 'field_key')
                .annotate(c=Count('id'))
            )
            for row in raw_comments:
                sid = row['shipment_id']
                key = row['field_key'] or '__shipment__'
                comment_counts.setdefault(sid, {})[key] = row['c']

            raw_tasks = (
                ShipmentComment.objects.filter(
                    shipment_id__in=ids,
                    is_deleted=False,
                    assignee__isnull=False,
                )
                .values('shipment_id', 'is_done')
                .annotate(c=Count('id'))
            )
            for row in raw_tasks:
                sid = row['shipment_id']
                bucket = task_counts.setdefault(sid, {'open': 0, 'done': 0, 'assigned_to_me_open': 0})
                if row['is_done']:
                    bucket['done'] += row['c']
                else:
                    bucket['open'] += row['c']

            # assigned_to_me_open — scoped to requesting user
            raw_mine = (
                ShipmentComment.objects.filter(
                    shipment_id__in=ids,
                    is_deleted=False,
                    assignee=request.user,
                    is_done=False,
                )
                .values('shipment_id')
                .annotate(c=Count('id'))
            )
            for row in raw_mine:
                sid = row['shipment_id']
                task_counts.setdefault(sid, {'open': 0, 'done': 0, 'assigned_to_me_open': 0})
                task_counts[sid]['assigned_to_me_open'] = row['c']

        # === row_settings: per-field trigger config + edit rights (Sheet Control v2) ===
        # Load SheetRowSetting once with prefetched relations and share with
        # get_sheet_edit_map to avoid a second identical query.
        #
        # Query budget (Phase 2a): +1 query for UserSheetRowPref.
        # Total: settings + 2 prefetch SELECTs + user_prefs + AuditLog window
        #        + comment_counts (2-3) + task_counts = ~9-10 queries.
        # Never add queries inside a per-row loop.
        settings_qs = (
            SheetRowSetting.objects.active()
            .select_related('triggered_user', 'updated_by')
            .prefetch_related('role_triggers', 'user_permissions__user')
            .order_by('display_order')
        )
        # settings_by_key: dict keyed by field_key, ordered by display_order (Python
        # dict preserves insertion order since 3.7 and settings_qs is sorted).
        settings_by_key: dict[str, SheetRowSetting] = {s.field_key: s for s in settings_qs}

        # === Phase 2a: Load per-user row preferences (1 extra query) ===
        # Keyed by row_id for fast lookup. Absent = no user pref (use admin defaults).
        user_prefs_by_row_id: dict[int, UserSheetRowPref] = {
            p.row_id: p
            for p in UserSheetRowPref.objects.filter(user=request.user)
        }

        edit_map = get_sheet_edit_map(request.user, settings_by_key=settings_by_key)

        # Build users_index: compact map of user_id → {name, role} for all users
        # referenced in settings (triggered_user + active user_permissions).
        # Avoids repeating user data per row.
        users_index: dict[str, dict] = {}

        def _register_user(u) -> None:
            """Add user to users_index if not already present."""
            if u is None:
                return
            uid = str(u.id)
            if uid not in users_index:
                users_index[uid] = {
                    'name': u.get_full_name() or u.username,
                    'role': getattr(u, 'role', None),
                }

        for s in settings_by_key.values():
            if s.triggered_user_id and s.triggered_user:
                _register_user(s.triggered_user)
            for up in s.user_permissions.all():
                if up.deleted_at is None and up.user_id and up.user:
                    _register_user(up.user)

        # current_user_id + lang for frontend personalisation
        current_user_id = request.user.id
        # User.language field does not exist yet — default to 'tk'
        current_user_lang = getattr(request.user, 'language', 'tk') or 'tk'

        # === Build row_settings with effective visibility (admin AND user hidden) ===
        # Order resolution (master plan §3.6 / ADR-0003):
        #   effective_order  = user_pref.position  if set  else  setting.display_order
        #   effective_visible = setting.is_visible AND NOT user_pref.is_hidden
        #
        # settings_by_key is insertion-ordered by display_order (the queryset
        # ordering). We build a list of (effective_order, field_key) tuples to
        # sort, then populate row_settings in that final order.

        # Step 1: determine effective order and visibility for every DEFAULT_SHEET_ROWS entry
        _row_candidates: list[tuple[int, str]] = []
        for row in DEFAULT_SHEET_ROWS:
            fk = row['field_key']
            setting = settings_by_key.get(fk)

            # Admin-level visibility gate (no DB config → treat as visible)
            if setting is not None and not setting.is_visible:
                continue

            # User-level visibility gate
            if setting is not None:
                pref = user_prefs_by_row_id.get(setting.pk)
                if pref and pref.is_hidden:
                    continue
                effective_order = (
                    pref.position if (pref and pref.position is not None)
                    else setting.display_order
                )
            else:
                # No DB config: put at end using a large fallback order
                effective_order = 999_999

            _row_candidates.append((effective_order, fk))

        # Step 2: sort by effective_order (stable — same position preserves DEFAULT_SHEET_ROWS order)
        _row_candidates.sort(key=lambda t: t[0])

        row_settings: dict[str, dict] = {}
        for _effective_order, fk in _row_candidates:
            setting = settings_by_key.get(fk)

            if setting is not None:
                # Compact labels / descriptions / style / who as nested objects
                labels = {
                    k: v for k, v in {
                        'tk': setting.label_tk,
                        'ru': setting.label_ru,
                        'en': setting.label_en,
                    }.items() if v
                }
                # Phase 5a: per-row override of Col B "Who" label (3 langs).
                # Frontend falls back to t(rowConfig.default_who_key) when this
                # block is null/empty for the user's lang.
                who = {
                    k: v for k, v in {
                        'tk': setting.who_tk,
                        'ru': setting.who_ru,
                        'en': setting.who_en,
                    }.items() if v
                }
                descriptions = {
                    k: v for k, v in {
                        'tk': setting.description_tk,
                        'ru': setting.description_ru,
                        'en': setting.description_en,
                    }.items() if v
                }
                style = {}
                if setting.style_width:
                    style['width'] = setting.style_width
                if setting.style_align:
                    style['align'] = setting.style_align
                if setting.style_color:
                    style['color'] = setting.style_color

                # triggered_roles: list of role codes from child table
                triggered_roles = [rt.role for rt in setting.role_triggers.all()]

                # extra_user_ids: user IDs from active user_permissions
                extra_user_ids = [
                    up.user_id
                    for up in setting.user_permissions.all()
                    if up.deleted_at is None and up.user_id is not None
                ]

                row_settings[fk] = {
                    # SheetRowSetting.id — required by the user-prefs PATCH
                    # endpoint, which keys by numeric id. Emitting it here lets
                    # the frontend skip a second round-trip to /admin/sheet-rows/.
                    'id': setting.id,
                    # Labels/who/descriptions/style (compact, omit empty)
                    'labels': labels or None,
                    'who': who or None,
                    'description': descriptions or None,
                    'style': style or None,
                    # Permission triggers
                    'triggered_user_id': setting.triggered_user_id,
                    'triggered_roles': triggered_roles,
                    'extra_user_ids': extra_user_ids,
                    'is_locked': setting.is_locked,
                    # Current user's edit right (pre-computed, no extra query)
                    'can_current_user_edit': edit_map.get(fk, False),
                    # Concurrency / audit
                    'version': setting.version,
                    'settings_updated_at': (
                        setting.updated_at.isoformat() if setting.updated_at else None
                    ),
                    'settings_updated_by_id': setting.updated_by_id,
                }
            else:
                # No DB config for this field — use field-perm fallback.
                # id stays null because there is no SheetRowSetting row to
                # reference; user-prefs PATCH will skip it on the frontend side.
                row_settings[fk] = {
                    'id': None,
                    'labels': None,
                    'who': None,
                    'description': None,
                    'style': None,
                    'triggered_user_id': None,
                    'triggered_roles': [],
                    'extra_user_ids': [],
                    'is_locked': False,
                    'can_current_user_edit': edit_map.get(fk, False),
                    'version': None,
                    'settings_updated_at': None,
                    'settings_updated_by_id': None,
                }

        # rows: in effective order (matches row_settings insertion order).
        # row_settings keys are already in effective_order sequence from the loop above.
        _visible_keys = set(row_settings.keys())
        # Build a lookup of field_key → DEFAULT_SHEET_ROWS entry for fast access
        _default_rows_by_key = {r['field_key']: r for r in DEFAULT_SHEET_ROWS}
        rows = [
            _default_rows_by_key[fk]
            for fk in row_settings.keys()
            if fk in _default_rows_by_key
        ]

        # === user_preferences: informational payload (ids only, not full state) ===
        # Lets the frontend know the user's current personal order without a second
        # API call. row_order is only the rows where user.position is set.
        _user_positioned = sorted(
            (p for p in user_prefs_by_row_id.values() if p.position is not None),
            key=lambda p: p.position,
        )
        user_preferences_payload = {
            'row_order': [p.row_id for p in _user_positioned],
            'hidden_rows': [p.row_id for p in user_prefs_by_row_id.values() if p.is_hidden],
        }

        # === last_edits: latest-edit summary per (shipment, field) — sparse (plan D8A) ===
        last_edits: dict[str, dict[str, dict]] = {}

        if ids:
            # Scoped-then-windowed: first bound to visible shipments, then rank within
            # each (shipment, field) partition. The subquery pattern avoids the MSSQL
            # restriction on filtering Window annotations in the same queryset.
            # MSSQL rejects ORDER BY inside subqueries without TOP/OFFSET. AuditLog
            # has Meta.ordering=['-created_at'] which propagates as an outer
            # ORDER BY on the ranked subquery. Strip it explicitly with order_by()
            # — the Window's own ORDER BY (inside OVER(...)) is the only ordering
            # this query needs. Without this, the /sheet/ endpoint 500s on MSSQL
            # the moment the AuditLog table has any rows.
            ranked = AuditLog.objects.filter(
                model_name='Shipment',
                object_id__in=ids,
                field_name__gt='',
            ).annotate(
                rn=Window(
                    expression=RowNumber(),
                    partition_by=[F('object_id'), F('field_name')],
                    order_by=F('created_at').desc(),
                ),
            ).order_by()
            latest_qs = AuditLog.objects.filter(
                pk__in=Subquery(ranked.filter(rn=1).values('pk'))
            ).select_related('user')

            for log_row in latest_qs:
                sid_str = str(log_row.object_id)
                user_name = (
                    (log_row.user.get_full_name() or log_row.user.username)
                    if log_row.user_id
                    else None
                )
                last_edits.setdefault(sid_str, {})[log_row.field_name] = {
                    'user_id': log_row.user_id,
                    'user_name': user_name,
                    'old_value': log_row.old_value,
                    'new_value': log_row.new_value,
                    'edited_at': log_row.created_at.isoformat() if log_row.created_at else None,
                }

        return Response({
            'results': shipment_data,
            'comment_counts': comment_counts,
            'task_counts': task_counts,
            'rows': rows,
            'row_settings': row_settings,
            'last_edits': last_edits,
            # Sheet Control v2 additions
            'users_index': users_index,
            'current_user_id': current_user_id,
            'current_user_lang': current_user_lang,
            # Phase 2a: per-user row preferences (order + hidden)
            # row_order contains only ids where user.position IS NOT NULL
            # hidden_rows contains ids where user.is_hidden=True
            'user_preferences': user_preferences_payload,
        })

    @action(detail=True, methods=['get'], url_path='field-history')
    def field_history(self, request, pk=None):
        """GET /api/v1/export/shipments/{id}/field-history/?field=<field_key>&limit=50

        Returns the AuditLog rows for a single (shipment, field) pair, newest
        first. Useful for a "history" popover in the cell-level audit UI.

        Query params:
            field (str, required): The field_key to retrieve history for.
            limit (int, default 50, max 200): How many rows to return.

        Permission: ``can_edit_sheet_field(user, field_key)`` — per plan D8.
        Reading historical cell values is gated by edit permission because old
        values (prices, buyer data) are sensitive.

        Returns:
            { "results": [{user_id, user_name, old_value, new_value, edited_at}] }

        Errors:
            400 if ``field`` param is missing or empty.
            403 if the user lacks edit permission on the field.
            404 if the shipment does not exist or isn't in the current queryset.
        """
        # 404 check first — avoids leaking existence via 403
        shipment = self.get_object()

        field_key = request.query_params.get('field', '').strip()
        if not field_key:
            return Response(
                {'error': "'field' query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Permission gate: edit access required to read full history (plan D8)
        if not can_edit_sheet_field(request.user, field_key):
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        try:
            limit = min(int(request.query_params.get('limit', 50)), 200)
        except (TypeError, ValueError):
            limit = 50

        logs = (
            AuditLog.objects.filter(
                model_name='Shipment',
                object_id=shipment.pk,
                field_name=field_key,
            )
            .select_related('user')
            .order_by('-created_at')[:limit]
        )

        results = [
            {
                'user_id': log.user_id,
                'user_name': (
                    (log.user.get_full_name() or log.user.username)
                    if log.user_id else None
                ),
                'old_value': log.old_value,
                'new_value': log.new_value,
                'edited_at': log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ]

        return Response({'results': results})

    def create(self, request, *args, **kwargs):
        """POST /api/v1/export/shipments/

        Two-phase shipment creation:

        - is_draft=False (default): creates at yuklenme (full path).
          Restricted to export_manager / director.
        - is_draft=True: creates a DRAFT (step 0) with one or more block sources.
          Allowed for warehouse_chief, export_manager, and director.
          country/customer may be omitted — they are filled at assignment time.

        Returns full shipment detail with HTTP 201 on success.
        """
        user_role = getattr(request.user, 'role', None)

        serializer = ShipmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        is_draft = data.get('is_draft', False)

        # Role gate: drafts are accessible to warehouse_chief; full creation needs privilege.
        if is_draft:
            allowed_draft_roles = PRIVILEGED_ROLES | {'warehouse_chief'}
            if user_role not in allowed_draft_roles:
                return Response(
                    {'error': 'Only warehouse_chief, export_manager, or director can create draft shipments'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        else:
            if user_role not in PRIVILEGED_ROLES:
                return Response(
                    {'error': 'Only export_manager or director can create shipments'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if is_draft:
            try:
                shipment = self._create_draft_shipment(data, request.user)
            except ValueError as exc:
                return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        else:
            try:
                shipment = create_shipment(
                    cargo_code=data['cargo_code'],
                    date=data['date'],
                    user=request.user,
                    country=data.get('country'),
                    customer=data.get('customer'),
                    season=data.get('season'),
                )
            except ValueError as exc:
                return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        detail_serializer = ShipmentDetailSerializer(shipment, context={'request': request})
        return Response(detail_serializer.data, status=status.HTTP_201_CREATED)

    def _create_draft_shipment(self, data: dict, user) -> Shipment:
        """Create a Shipment in DRAFT status together with its ShipmentBlockSource rows.

        Runs inside a single atomic transaction so that a failure during
        bulk_create rolls back the shipment header as well.

        Args:
            data: Validated data from ShipmentCreateSerializer (is_draft=True path).
            user: The user performing the creation.

        Returns:
            The newly created Shipment instance.

        Raises:
            ValueError: If no active season is found or draft status is not configured.
        """
        from apps.core.models import Season, ShipmentStatusType
        from apps.export.models import ShipmentStatusLog

        season = data.get('season')
        if season is None:
            season = Season.objects.filter(is_active=True).first()
            if season is None:
                raise ValueError('No active season found. Provide a season in the request.')

        try:
            draft_status = ShipmentStatusType.objects.get(code='draft')
        except ShipmentStatusType.DoesNotExist:
            raise ValueError('Draft status not configured. Run migrate and seed_data first.')

        with transaction.atomic():
            shipment = Shipment.objects.create(
                cargo_code=data['cargo_code'],
                date=data['date'],
                country=data.get('country'),
                customer=data.get('customer'),
                season=season,
                status=draft_status,
                created_by=user,
                notes=data.get('notes') or None,
            )

            ShipmentStatusLog.objects.create(
                shipment=shipment,
                status=draft_status,
                changed_by=user,
                comment='Draft created',
            )

            block_source_rows = [
                ShipmentBlockSource(
                    shipment=shipment,
                    block=row['block_id'],
                    weight_kg=row['weight_kg'],
                )
                for row in data.get('block_sources', [])
            ]
            if block_source_rows:
                ShipmentBlockSource.objects.bulk_create(block_source_rows, batch_size=500)

        logger.info(
            'Draft shipment %s created by %s with %d block source(s)',
            shipment.cargo_code,
            user.username,
            len(block_source_rows),
        )
        return shipment

    @action(detail=True, methods=['post'], url_path='assign')
    def assign(self, request, pk=None):
        """POST /api/v1/export/shipments/{id}/assign/

        Assigns destination/customer fields to a DRAFT shipment and promotes it
        to yuklenme (step 1), writing loading_started_at per AD-1.

        Only export_manager and director may call this endpoint.

        Request body (all optional — update only the fields provided):
            {
                "country": <int>,
                "customer": <int>
            }

        Returns:
            200 with full ShipmentDetailSerializer payload on success.
            400 if the shipment is not in draft status, or transition fails.
            403 if the caller's role is not export_manager / director.
        """
        user_role = getattr(request.user, 'role', None)
        if user_role not in PRIVILEGED_ROLES:
            return Response(
                {'error': 'Only export_manager or director can assign draft shipments'},
                status=status.HTTP_403_FORBIDDEN,
            )

        shipment = self.get_object()

        if shipment.status.code != 'draft':
            return Response(
                {'error': 'Shipment is not a draft'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        assign_serializer = ShipmentAssignSerializer(data=request.data)
        assign_serializer.is_valid(raise_exception=True)
        assign_data = assign_serializer.validated_data

        try:
            with transaction.atomic():
                update_fields = []
                for field in ('country', 'city', 'customer', 'import_firm'):
                    if field in assign_data:
                        setattr(shipment, field, assign_data[field])
                        update_fields.append(field)
                if update_fields:
                    shipment.save(update_fields=update_fields)

                # Promote draft → yuklenme so AD-1 loading_started_at is set.
                transition_to(shipment, 'yuklenme', request.user, comment='assigned from draft')
        except PermissionError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        shipment.refresh_from_db()
        detail_serializer = ShipmentDetailSerializer(shipment, context={'request': request})
        return Response(detail_serializer.data)

    @action(detail=True, methods=['patch'], url_path='quality')
    def set_quality(self, request, pk=None):
        """PATCH /api/v1/export/shipments/{id}/quality/

        Creates or updates the QualityDocument for a shipment.
        Restricted to export_manager, document_team, and director roles.
        Returns full shipment detail on success.
        """
        if getattr(request.user, 'role', None) not in PRIVILEGED_ROLES | {'document_team'}:
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        shipment = self.get_object()
        quality, _ = QualityDocument.objects.get_or_create(shipment=shipment)
        quality_serializer = QualityDocumentSerializer(quality, data=request.data, partial=True)
        quality_serializer.is_valid(raise_exception=True)
        quality_serializer.save()
        logger.info(
            'QualityDocument for %s updated by %s',
            shipment.cargo_code,
            request.user.username,
        )
        detail_serializer = ShipmentDetailSerializer(shipment, context={'request': request})
        return Response(detail_serializer.data)

    @action(detail=True, methods=['post'], url_path='comment')
    def comment(self, request, pk=None):
        """POST /api/v1/export/shipments/{id}/comment/

        Backward-compatible comment creation endpoint. Delegates to the
        comment service so fan-out behavior matches CommentViewSet.

        Request body:
            { "content": "Some comment text" }

        Returns updated shipment detail on success.
        """
        from apps.export.services.comments import create_comment

        shipment = self.get_object()
        content = request.data.get('content', '').strip()

        if not content:
            return Response({'error': 'content is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            create_comment(shipment=shipment, user=request.user, content=content)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        shipment.refresh_from_db()
        detail_serializer = ShipmentDetailSerializer(shipment, context={'request': request})
        return Response(detail_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post', 'patch'], url_path='sales-report')
    def set_sales_report(self, request, pk=None):
        """POST or PATCH /api/v1/export/shipments/{id}/sales-report/

        Create or update the final sales report for a shipment.
        Only allowed when the shipment is at hasabat (step 12) or later.
        Restricted to sales_rep, export_manager, and director roles.

        Returns full shipment detail on success.
        """
        allowed_roles = PRIVILEGED_ROLES | {'sales_rep'}
        if getattr(request.user, 'role', None) not in allowed_roles:
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        shipment = self.get_object()

        # Only allowed at hasabat (step 12) or tamamlandy (step 13).
        if shipment.status is None or shipment.status.step_order < 12:
            return Response(
                {'error': 'Sales report can only be submitted when shipment is at hasabat status or later.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        report, _ = SalesReport.objects.get_or_create(
            shipment=shipment,
            defaults={'created_by': request.user},
        )
        serializer = SalesReportSerializer(report, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        logger.info(
            'SalesReport for %s saved by %s',
            shipment.cargo_code,
            request.user.username,
        )

        shipment.refresh_from_db()
        detail_serializer = ShipmentDetailSerializer(shipment, context={'request': request})
        return Response(detail_serializer.data)

    @action(detail=True, methods=['post'], url_path='block-sources')
    def set_block_sources(self, request, pk=None):
        """POST /api/v1/export/shipments/{id}/block-sources/

        Replace all block sources for a shipment.
        Request body: { "blocks": [{ "block_id": 1, "weight_kg": 18000 }, ...] }

        ``weight_kg`` is optional. When omitted (or 0), the server splits the
        shipment's real ``weight_net`` evenly across the selected blocks. If
        ``weight_net`` is null, falls back to ``get_default_truck_weight(1)``
        (single-firm cap) divided by N. Last entry receives the rounding
        remainder so the sum exactly matches the source total.
        """
        shipment = self.get_object()
        blocks_data = request.data.get('blocks', [])

        if not isinstance(blocks_data, list):
            return Response(
                {'error': 'blocks must be a list'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        valid_entries = [e for e in blocks_data if e.get('block_id')]
        n = len(valid_entries)

        # Build per-row weights — explicit overrides win; otherwise auto-split.
        auto_weights: list[Decimal] = []
        if n > 0:
            total = shipment.weight_net or get_default_truck_weight(1)
            base = (Decimal(total) / n).quantize(Decimal('0.01'))
            auto_weights = [base] * (n - 1)
            auto_weights.append((Decimal(total) - base * (n - 1)).quantize(Decimal('0.01')))

        shipment.block_sources.all().delete()
        rows = []
        for i, entry in enumerate(valid_entries):
            override = entry.get('weight_kg')
            weight = (
                Decimal(str(override))
                if override not in (None, 0, '0', '0.00')
                else auto_weights[i]
            )
            rows.append(ShipmentBlockSource(
                shipment=shipment,
                block_id=entry['block_id'],
                weight_kg=weight,
            ))
        if rows:
            ShipmentBlockSource.objects.bulk_create(rows, batch_size=500)

        logger.info(
            'Block sources for %s updated by %s (%d blocks)',
            shipment.cargo_code, request.user.username, n,
        )
        return Response({'status': 'ok', 'count': n})

    @action(detail=True, methods=['post'], url_path='firm-splits')
    def set_firm_splits(self, request, pk=None):
        """POST /api/v1/export/shipments/{id}/firm-splits/

        Replace all firm splits for a shipment.
        Request body: { "firms": [{ "export_firm_id": 1, "weight_kg": 9000 }, ...] }
        """
        shipment = self.get_object()
        firms_data = request.data.get('firms', [])

        if not isinstance(firms_data, list):
            return Response(
                {'error': 'firms must be a list'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            # Check approved records before deleting — inside transaction to prevent race
            approved_count = shipment.quota_usage_records.filter(status='approved').count()
            if approved_count > 0:
                return Response(
                    {'error': 'Cannot reassign firm splits: approved quota usage records exist. Delete them first.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            valid_entries = [e for e in firms_data if e.get('export_firm_id')]
            num_firms = len(valid_entries)
            # Official per-firm kg from TruckSplitDefault (admin-configurable).
            # ShipmentFirmSplit.weight_kg is the OFFICIAL export number, not the
            # real truck weight — see ADR-016.
            official_kg = (
                get_default_truck_weight(num_firms) if num_firms > 0 else Decimal('0')
            )

            shipment.firm_splits.all().delete()
            split_rows = []
            for i, entry in enumerate(valid_entries):
                override = entry.get('weight_kg')
                weight = (
                    Decimal(str(override))
                    if override not in (None, 0, '0', '0.00')
                    else official_kg
                )
                split_rows.append(ShipmentFirmSplit(
                    shipment=shipment,
                    export_firm_id=entry['export_firm_id'],
                    weight_kg=weight,
                    split_order=i + 1,
                ))
            if split_rows:
                ShipmentFirmSplit.objects.bulk_create(split_rows, batch_size=500)

            # Auto-create quota usage records (draft) for each firm split
            shipment.quota_usage_records.filter(status='draft').delete()
            if num_firms > 0:
                default_kg = official_kg
                QuotaUsageRecord.objects.bulk_create([
                    QuotaUsageRecord(
                        usage_date=shipment.date,
                        export_firm_id=row.export_firm_id,
                        kg_used=default_kg,
                        product_type='tomato',  # TODO: derive from shipment context when pepper support is added
                        shipment=shipment,
                        status='draft',
                        created_by=request.user,
                    )
                    for row in split_rows
                ], batch_size=500)

        logger.info(
            'Firm splits for %s updated by %s (%d firms, %d usage records)',
            shipment.cargo_code, request.user.username, len(firms_data), num_firms,
        )
        return Response({'status': 'ok', 'count': len(firms_data)})

    @action(detail=True, methods=['get', 'post'], url_path='pallets')
    def pallets(self, request, pk=None):
        """GET/POST /api/v1/export/shipments/{id}/pallets/

        GET: return the list of pallets for this shipment.
        POST: bulk upsert — replaces ALL existing pallets with the submitted list.
              Accepts { "pallets": [...] }. Only weight_master and warehouse_chief
              (plus privileged roles) may write.

        Returns 200 with pallet list on success.
        """
        shipment = self.get_object()

        if request.method == 'GET':
            qs = shipment.pallets.select_related('crate_type', 'variety', 'sub_block', 'created_by')
            serializer = PalletSerializer(qs, many=True)
            return Response(serializer.data)

        # POST — bulk upsert
        allowed_write_roles = PRIVILEGED_ROLES | {'warehouse_chief', 'weight_master'}
        if getattr(request.user, 'role', None) not in allowed_write_roles:
            return Response(
                {'error': 'Only weight_master, warehouse_chief, export_manager, or director can submit pallets'},
                status=status.HTTP_403_FORBIDDEN,
            )

        bulk_serializer = PalletBulkUpsertSerializer(data=request.data)
        bulk_serializer.is_valid(raise_exception=True)
        pallets_data = bulk_serializer.validated_data['pallets']

        with transaction.atomic():
            shipment.pallets.all().delete()
            pallet_rows = [
                Pallet(
                    shipment=shipment,
                    pallet_number=p['pallet_number'],
                    crate_type=p['crate_type'],
                    crate_count=p['crate_count'],
                    gross_weight_kg=p['gross_weight_kg'],
                    pallet_weight_kg=p['pallet_weight_kg'],
                    additions_kg=p.get('additions_kg', 0),
                    variety=p['variety'],
                    sub_block=p['sub_block'],
                    loaded_at=p.get('loaded_at') or timezone.now(),
                    created_by=request.user,
                )
                for p in pallets_data
            ]
            Pallet.objects.bulk_create(pallet_rows, batch_size=500)

        logger.info(
            'Pallets for %s upserted by %s (%d pallets)',
            shipment.cargo_code, request.user.username, len(pallet_rows),
        )
        qs = shipment.pallets.select_related('crate_type', 'variety', 'sub_block', 'created_by')
        serializer = PalletSerializer(qs, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='manifest/close')
    def manifest_close(self, request, pk=None):
        """POST /api/v1/export/shipments/{id}/manifest/close/

        Close the pallet manifest: aggregate pallet weights into shipment totals
        and compute dominant variety roll-up.

        Only weight_master and warehouse_chief (plus privileged roles) may trigger.

        Returns refreshed shipment detail on success.
        """
        allowed_roles = PRIVILEGED_ROLES | {'warehouse_chief', 'weight_master'}
        if getattr(request.user, 'role', None) not in allowed_roles:
            return Response(
                {'error': 'Only weight_master, warehouse_chief, export_manager, or director can close the manifest'},
                status=status.HTTP_403_FORBIDDEN,
            )

        shipment = self.get_object()

        try:
            close_pallet_manifest(shipment, request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        shipment.refresh_from_db()
        serializer = ShipmentDetailSerializer(shipment, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='varieties/override')
    def varieties_override(self, request, pk=None):
        """POST /api/v1/export/shipments/{id}/varieties/override/

        Manual variety override by warehouse_chief or export_manager.
        Request body: { "variety_ids": [int, ...] } (1-4 entries, ordered by dominance)

        Returns refreshed shipment detail on success.
        """
        allowed_roles = PRIVILEGED_ROLES | {'warehouse_chief'}
        if getattr(request.user, 'role', None) not in allowed_roles:
            return Response(
                {'error': 'Only warehouse_chief, export_manager, or director can override varieties'},
                status=status.HTTP_403_FORBIDDEN,
            )

        shipment = self.get_object()
        override_serializer = VarietyOverrideSerializer(data=request.data)
        override_serializer.is_valid(raise_exception=True)
        variety_ids = override_serializer.validated_data['variety_ids']

        try:
            override_dominant_varieties(shipment, variety_ids, request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        shipment.refresh_from_db()
        serializer = ShipmentDetailSerializer(shipment, context={'request': request})
        return Response(serializer.data)


class CommentViewSet(ModelViewSet):
    """CRUD for shipment comments.

    GET    /api/v1/export/comments/?shipment=&field_key=&assignee=me&is_done=&parent_comment=null
    POST   /api/v1/export/comments/            — create via CommentCreateSerializer
    PATCH  /api/v1/export/comments/{id}/       — edit own comment content
    DELETE /api/v1/export/comments/{id}/       — soft-delete
    POST   /api/v1/export/comments/{id}/done/  — mark task done
    POST   /api/v1/export/comments/{id}/reopen/ — reopen task
    """

    resource_code = 'shipment_comment'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self) -> QuerySet:
        from django.db.models import Prefetch

        # Filter prefetched replies to match the parent's is_deleted=False guard
        # so replies_count returned by the serializer is consistent with the
        # actual number of visible replies.
        non_deleted_replies = Prefetch(
            'replies',
            queryset=ShipmentComment.objects.filter(is_deleted=False),
        )
        qs = (
            ShipmentComment.objects.filter(is_deleted=False)
            .select_related('user', 'assignee', 'done_by')
            .prefetch_related(non_deleted_replies)
        )

        params = self.request.query_params

        shipment_id = params.get('shipment')
        if shipment_id:
            qs = qs.filter(shipment_id=shipment_id)

        field_key = params.get('field_key')
        if field_key is not None:
            qs = qs.filter(field_key=field_key)

        assignee_param = params.get('assignee')
        if assignee_param == 'me':
            qs = qs.filter(assignee=self.request.user)
        elif assignee_param:
            qs = qs.filter(assignee_id=assignee_param)

        is_done_param = params.get('is_done')
        if is_done_param is not None:
            qs = qs.filter(is_done=(is_done_param.lower() in ('true', '1')))

        parent_param = params.get('parent_comment')
        if parent_param == 'null':
            qs = qs.filter(parent_comment__isnull=True)
        elif parent_param:
            qs = qs.filter(parent_comment_id=parent_param)

        return qs

    def get_serializer_class(self):
        if self.action == 'create':
            return CommentCreateSerializer
        return CommentSerializer

    def perform_create(self, serializer):
        """Delegate to service via CommentCreateSerializer.create()."""
        serializer.save()

    def partial_update(self, request, *args, **kwargs):
        """PATCH — edit content only. Own comments (or privileged role)."""
        comment = self.get_object()
        role = getattr(request.user, 'role', None)
        is_privileged = role in PRIVILEGED_ROLES

        if comment.user_id != request.user.id and not is_privileged:
            return Response({'error': 'You can only edit your own comments.'}, status=status.HTTP_403_FORBIDDEN)

        content = request.data.get('content', '').strip()
        if not content:
            return Response({'error': 'content is required'}, status=status.HTTP_400_BAD_REQUEST)

        comment.content = content
        comment.updated_at = timezone.now()
        comment.save(update_fields=['content', 'updated_at'])

        serializer = CommentSerializer(comment)
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        """DELETE — soft-delete. Own comments (or privileged role)."""
        comment = self.get_object()
        role = getattr(request.user, 'role', None)
        is_privileged = role in PRIVILEGED_ROLES

        if comment.user_id != request.user.id and not is_privileged:
            return Response({'error': 'You can only delete your own comments.'}, status=status.HTTP_403_FORBIDDEN)

        comment.is_deleted = True
        comment.save(update_fields=['is_deleted'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='done')
    def done(self, request, pk=None):
        """POST /api/v1/export/comments/{id}/done/

        Mark a task comment as done. Caller must be the assignee or a privileged role.
        """
        from apps.export.services.comments import mark_task_done

        comment = self.get_object()
        role = getattr(request.user, 'role', None)
        is_privileged = role in PRIVILEGED_ROLES

        if comment.assignee_id != request.user.id and not is_privileged:
            return Response(
                {'error': 'Only the assignee or an admin can mark a task done.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            mark_task_done(comment, request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        comment.refresh_from_db()
        return Response(CommentSerializer(comment).data)

    @action(detail=True, methods=['post'], url_path='reopen')
    def reopen(self, request, pk=None):
        """POST /api/v1/export/comments/{id}/reopen/

        Reopen a completed task. Author, assignee, or a privileged role may reopen.
        """
        from apps.export.services.comments import reopen_task

        comment = self.get_object()
        role = getattr(request.user, 'role', None)
        is_privileged = role in PRIVILEGED_ROLES

        # Mirror the bypass pattern used by done/destroy/partial_update so admins
        # can reopen tasks they didn't author and aren't assigned to.
        if (
            comment.user_id != request.user.id
            and comment.assignee_id != request.user.id
            and not is_privileged
        ):
            return Response(
                {'error': 'Only the author, assignee, or an admin can reopen a task.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            reopen_task(comment, request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        comment.refresh_from_db()
        return Response(CommentSerializer(comment).data)
