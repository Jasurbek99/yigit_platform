import logging
from decimal import Decimal

from django.db import transaction
from django.db.models import (
    Count,
    Exists,
    F,
    OuterRef,
    Prefetch,
    Q,
    QuerySet,
    Subquery,
)
from django.db.models.functions import Now, RowNumber
from django.db.models.expressions import Window
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import viewsets
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
    ShipmentDraftListSerializer,
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
from apps.export.services.shipment import _cancel_open_tasks

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
        # Joined for the expanded list serializer (Sheet-parity columns):
        # import firm name, creator username, and quality doc flags.
        'import_firm', 'created_by', 'quality',
    ).order_by('-date', '-id')

    filterset_fields = ['status', 'country', 'season', 'is_gapy_satys', 'customer']
    search_fields = ['cargo_code']

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ShipmentDetailSerializer
        if (
            self.action == 'list'
            and self.request.query_params.get('status_code') == 'draft'
        ):
            return ShipmentDraftListSerializer
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
        from django.db.models import F, Prefetch
        from django.utils import timezone as _tz

        qs = super().get_queryset()

        # ── Detail-only prefetches (D1) ───────────────────────────────────────
        # Tasks and status_log are only needed by ShipmentDetailSerializer.
        # Adding them to list/sheet queries would waste significant DB time.
        if getattr(self, 'action', None) == 'retrieve':
            from apps.export.models import Task as _Task, ShipmentStatusLog as _Log
            task_prefetch = Prefetch(
                'tasks',
                queryset=_Task.objects.select_related('rule', 'assignee_user').order_by(
                    F('deadline').asc(nulls_last=True), 'created_at'
                ),
            )
            log_prefetch = Prefetch(
                'status_log',
                queryset=_Log.objects.select_related('status', 'changed_by').order_by(
                    '-changed_at'
                ),
            )
            qs = qs.prefetch_related(task_prefetch, log_prefetch)

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
            # Draft list serializer needs created_by + block_sources; pre-load
            # them here so the DraftPool render avoids per-row queries.
            if status_code == 'draft' and getattr(self, 'action', None) == 'list':
                qs = qs.select_related('created_by').prefetch_related('block_sources__block')
        # Cancelled shipments are hidden from the operational list by default.
        # ?show_cancelled=true reveals them; an explicit ?status_code=cancelled
        # filter also shows them. Scoped to `list` so detail pages of cancelled
        # shipments stay reachable via retrieve.
        if getattr(self, 'action', None) == 'list':
            show_cancelled = self.request.query_params.get('show_cancelled') == 'true'
            explicit_cancelled = self.request.query_params.get('status_code') == 'cancelled'
            if not show_cancelled and not explicit_cancelled:
                qs = qs.exclude(status__code='cancelled')
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
            # Set updated_by so Shipment.save() → auto_advance_if_ready() has
            # a user to credit for any auto-transition this PATCH triggers.
            serializer.save(updated_by=request.user)
            # Reload from DB so computed fields (auto_now timestamps, DB defaults) are fresh.
            instance = serializer.instance
            instance.refresh_from_db()
            after = snapshot_fields(instance, submitted_keys)

            audit_rows = diff_audit_rows(instance, before, after, request.user)
            if audit_rows:
                AuditLog.objects.bulk_create(audit_rows, batch_size=500)

        # Mark OPEN tasks targeting any of the submitted fields as IN_PROGRESS.
        # Must happen AFTER save so Shipment.save() auto-resolution runs first
        # (tasks that are already DONE won't be touched here).
        from apps.export.services.task_rules import mark_started_for_changed_fields
        mark_started_for_changed_fields(instance, submitted_keys)

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

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        """POST /api/v1/export/shipments/{id}/cancel/

        Request body:
            { "reason": "non-empty string" }

        Permissions: admin / export_manager / director, or any superuser.
        Effects:
          - Transitions the shipment to 'cancelled' via transition_to().
          - All OPEN/IN_PROGRESS/BLOCKED Tasks on the shipment are marked CANCELLED.
          - Draft QuotaUsageRecords linked to the shipment are deleted.
          - Approved QuotaUsageRecords are left intact; their IDs are surfaced
            in the response so the user can reconcile via the QuotaUsageGrid.

        Returns:
            ShipmentDetailSerializer response plus two extra fields:
              draft_quota_deleted:        number of draft quota records removed
              approved_quota_to_reconcile: list of approved quota record IDs
        """
        is_super = getattr(request.user, 'is_superuser', False)
        if not is_super and getattr(request.user, 'role', None) not in PRIVILEGED_ROLES:
            return Response(
                {'error': 'Only admin, export_manager or director can cancel shipments'},
                status=status.HTTP_403_FORBIDDEN,
            )

        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response(
                {'reason': ['A cancellation reason is required.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        shipment = self.get_object()

        try:
            with transaction.atomic():
                transition_to(shipment, 'cancelled', request.user, comment=reason)
                _cancel_open_tasks(shipment)
                # Quota cleanup: delete draft records (placeholder allocations),
                # surface approved records so the user can reconcile manually.
                draft_qs = QuotaUsageRecord.objects.filter(
                    shipment=shipment, status='draft',
                )
                draft_count = draft_qs.count()
                draft_qs.delete()
                approved_ids = list(
                    QuotaUsageRecord.objects.filter(
                        shipment=shipment, status='approved',
                    ).values_list('id', flat=True)
                )
        except PermissionError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        serializer = ShipmentDetailSerializer(shipment, context={'request': request})
        data = serializer.data
        data['draft_quota_deleted'] = draft_count
        data['approved_quota_to_reconcile'] = approved_ids
        return Response(data)

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
            )
            .filter(**season_filter)
            # Phase 3: the operational Sheet view never shows archived rows.
            # Archive view lives on ShipmentList — no Sheet equivalent.
            .filter(is_archived=False)
            .order_by('-date', '-id')
        )

        serializer = ShipmentSheetSerializer(qs, many=True)
        shipment_data = serializer.data

        # === Phase 5c — custom field values per shipment (one query, no N+1) ===
        # Inject shipment.custom_fields = { field_key: value_text } onto each
        # serialized shipment dict so the frontend can render custom rows
        # without a second round-trip.
        from apps.export.models import ShipmentCustomFieldValue
        ids = [s.id for s in qs]
        custom_fields_by_shipment: dict[int, dict[str, str]] = {}
        if ids:
            for cv in (
                ShipmentCustomFieldValue.objects
                .filter(shipment_id__in=ids, row__deleted_at__isnull=True, row__is_visible=True)
                .select_related('row')
                .only('shipment_id', 'value_text', 'row__field_key')
            ):
                custom_fields_by_shipment.setdefault(cv.shipment_id, {})[cv.row.field_key] = cv.value_text
        for s in shipment_data:
            s['custom_fields'] = custom_fields_by_shipment.get(s['id'], {})

        # === Per-cell comment counts (single query, grouped in Python — no N+1) ===
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

        # Step 1: determine effective order and visibility for every DEFAULT_SHEET_ROWS
        # entry AND every is_custom=True row (Phase 5c). Custom rows live in
        # SheetRowSetting only — they have no DEFAULT_SHEET_ROWS entry — but they
        # still need to surface in the Sheet view so admins can read/write them.
        _row_candidates: list[tuple[int, str]] = []
        _default_field_keys = {r['field_key'] for r in DEFAULT_SHEET_ROWS}
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

        # Phase 5c: append custom rows. They land at the end by default
        # (display_order is set to max+1024 at create time); user prefs apply
        # the same way as DEFAULT_SHEET_ROWS-backed rows.
        for fk, setting in settings_by_key.items():
            if not setting.is_custom or fk in _default_field_keys:
                continue
            if not setting.is_visible:
                continue
            pref = user_prefs_by_row_id.get(setting.pk)
            if pref and pref.is_hidden:
                continue
            effective_order = (
                pref.position if (pref and pref.position is not None)
                else setting.display_order
            )
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
        rows = []
        for fk in row_settings.keys():
            default_entry = _default_rows_by_key.get(fk)
            if default_entry is not None:
                rows.append(default_entry)
                continue
            # Phase 5c: synthesize an IRowConfig-shaped entry for custom rows.
            # input_type=text is fixed (typed custom fields go through the L2
            # runbook). default_who_key falls back to a generic key; the admin
            # can override per-row via who_tk/_ru/_en (Phase 5a).
            setting = settings_by_key.get(fk)
            if setting is None or not setting.is_custom:
                continue
            rows.append({
                'row_number': setting.row_number,
                'field_key': fk,
                'default_who_key': 'sheet.who.custom',
                'label_key': f'sheet.row.{fk}',  # i18n fallback; admin override wins
                'input_type': 'text',
                'style': 'base',
            })

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

        # Stream F-followup: cargo_code and date are now optional on create.
        # cargo_code is auto-generated server-side when missing; date defaults
        # to today. Soltanmyrat's physical pallet code (official_export_code)
        # is filled in later via the Sheet/Detail edit paths.
        from apps.export.services.shipment import generate_cargo_code
        from django.utils import timezone as _tz

        cargo_code = data.get('cargo_code') or generate_cargo_code()
        ship_date = data.get('date') or _tz.now().date()
        # Mutate the validated data so downstream paths see the resolved values.
        data['cargo_code'] = cargo_code
        data['date'] = ship_date

        if is_draft:
            try:
                shipment = self._create_draft_shipment(data, request.user)
            except ValueError as exc:
                return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        else:
            try:
                shipment = create_shipment(
                    cargo_code=cargo_code,
                    date=ship_date,
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

        bs_rows = data.get('block_sources', [])

        with transaction.atomic():
            # Race-safe drawdown re-check under a forecast-row lock (the
            # serializer's upfront check is unlocked; this is authoritative).
            if bs_rows:
                from apps.export.services.harvest_forecast import assert_draw_within_pool
                assert_draw_within_pool(
                    {row['block_id'].id: row['weight_kg'] for row in bs_rows},
                    data['date'],
                )

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

        # Generate the draft-stage tasks (Stream F). Outside the atomic block so
        # a generation failure doesn't roll back the legitimate shipment+log
        # write — same trade-off as transition_to(). Idempotent.
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, 'draft')

        return shipment

    @action(detail=True, methods=['post'], url_path='assign')
    def assign(self, request, pk=None):
        """POST /api/v1/export/shipments/{id}/assign/

        Assigns destination/customer fields to a DRAFT shipment and promotes
        it to the next status (gumruk_girish in state machine v2). Acts as a
        manual override of the auto-advance flow — useful when an
        export_manager wants to commit a draft without waiting for the
        documents_status field to be set.

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

                # Promote draft → gumruk_girish (state machine v2). Was draft →
                # yuklenme in v1. Operators can also reach this state by setting
                # documents_status='in_progress' on the Sheet (auto-advance).
                transition_to(shipment, 'gumruk_girish', request.user, comment='assigned from draft')
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

    @action(detail=True, methods=['patch'], url_path='custom-fields')
    def patch_custom_fields(self, request, pk=None):
        """PATCH /api/v1/export/shipments/{id}/custom-fields/

        Phase 5c — write a per-shipment value for an admin-created custom row.

        Body:
            { "field_key": "custom_<slug>", "value": "..." }

        Reuses can_edit_sheet_field(user, field_key) so locks / role triggers /
        extra-user grants from the Phase 1 permission machinery still gate
        custom rows. Empty string is allowed and means "explicitly cleared
        by user" — the value row stays so updated_at + updated_by track the
        clearing.
        """
        from apps.core.permissions import can_edit_sheet_field
        from apps.export.models import ShipmentCustomFieldValue

        shipment = self.get_object()
        if shipment.is_archived:
            return Response(
                {'error': 'Archived shipments are read-only.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        field_key = (request.data.get('field_key') or '').strip()
        if not field_key.startswith('custom_'):
            return Response(
                {'error': "field_key must start with 'custom_'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            row = SheetRowSetting.objects.active().get(field_key=field_key, is_custom=True)
        except SheetRowSetting.DoesNotExist:
            return Response(
                {'error': f"No active custom row with field_key='{field_key}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not can_edit_sheet_field(request.user, field_key):
            return Response(
                {'error': f"Role '{getattr(request.user, 'role', None)}' "
                          f"cannot edit custom field '{field_key}'."},
                status=status.HTTP_403_FORBIDDEN,
            )

        value = request.data.get('value', '')
        if value is None:
            value = ''
        if not isinstance(value, str):
            return Response(
                {'error': 'value must be a string.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ShipmentCustomFieldValue.objects.update_or_create(
            shipment=shipment,
            row=row,
            defaults={'value_text': value, 'updated_by': request.user},
        )

        AuditLog.objects.create(
            user=request.user,
            action='update',
            model_name='Shipment',
            object_id=shipment.id,
            object_repr=shipment.cargo_code,
            field_name=field_key,
            old_value='',  # we don't snapshot the prior value for custom fields here
            new_value=value[:500],
            detail=f'custom field {field_key} → {value[:200]}',
        )

        return Response({'field_key': field_key, 'value': value}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post', 'patch'], url_path='sales-report')
    def set_sales_report(self, request, pk=None):
        """POST or PATCH /api/v1/export/shipments/{id}/sales-report/

        Create or update the final sales report for a shipment.
        Only allowed when the shipment is at satyldy (step 11) or later —
        that's "Sold, waiting for Report". Entering the Report Date here
        auto-advances the shipment to tamamlandy.
        Restricted to sales_rep, export_manager, and director roles.

        Returns full shipment detail on success.
        """
        allowed_roles = PRIVILEGED_ROLES | {'sales_rep'}
        if getattr(request.user, 'role', None) not in allowed_roles:
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        shipment = self.get_object()

        # State machine v2: satyldy is step 11, tamamlandy is step 12.
        if shipment.status is None or shipment.status.step_order < 11:
            return Response(
                {'error': 'Sales report can only be submitted when shipment is at satyldy status or later.'},
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
        Request body: { "blocks": [{ "block_id": 1, "weight_kg": 18000, "harvest_date": "2026-05-11" }, ...] }

        ``weight_kg`` is optional. When omitted (or 0), the server splits the
        shipment's real ``weight_net`` evenly across the selected blocks. If
        ``weight_net`` is null, falls back to ``get_default_truck_weight(1)``
        (single-firm cap) divided by N. Last entry receives the rounding
        remainder so the sum exactly matches the source total.

        ``harvest_date`` is optional per-block. When the R8 multi-select editor
        re-picks blocks without sending harvest_date, the server preserves the
        existing date by reading the prior block_id → date map before deleting
        the rows. Pass harvest_date=null explicitly to clear.
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

        # Preserve existing harvest_date for blocks the caller didn't send —
        # R8's multiselect editor only ships block_id, so without this the
        # date would silently reset every time blocks were reordered.
        existing_dates = dict(
            shipment.block_sources.values_list('block_id', 'harvest_date')
        )

        shipment.block_sources.all().delete()
        rows = []
        for i, entry in enumerate(valid_entries):
            override = entry.get('weight_kg')
            weight = (
                Decimal(str(override))
                if override not in (None, 0, '0', '0.00')
                else auto_weights[i]
            )
            # harvest_date semantics: explicit key (even null) overrides the
            # preserved value; absent key falls back to the prior date.
            block_id = entry['block_id']
            if 'harvest_date' in entry:
                harvest_date = entry['harvest_date'] or None
            else:
                harvest_date = existing_dates.get(block_id)
            rows.append(ShipmentBlockSource(
                shipment=shipment,
                block_id=block_id,
                weight_kg=weight,
                harvest_date=harvest_date,
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


    @action(detail=True, methods=['get'], url_path='tasks')
    def tasks_list(self, request, pk=None):
        """GET /api/v1/export/shipments/{id}/tasks/

        Returns all tasks for this shipment grouped by step code.

        Response shape:
            { "<step_code>": [TaskListSerializer, ...], ... }

        Empty steps are omitted. Tasks within each step are ordered by
        deadline asc, then created_at asc.
        """
        from apps.export.models import Task
        from apps.export.serializers import TaskListSerializer

        shipment = self.get_object()
        tasks_qs = (
            Task.objects
            .filter(shipment=shipment)
            .select_related('shipment__status', 'rule', 'assignee_user')
            .order_by('deadline', 'created_at')
        )

        grouped: dict[str, list] = {}
        for task in tasks_qs:
            step = task.step
            if step not in grouped:
                grouped[step] = []
            grouped[step].append(TaskListSerializer(task).data)

        return Response(grouped)

    @action(detail=False, methods=['get'], url_path='board')
    def board(self, request):
        """GET /api/v1/export/shipments/board/

        Aggregated phase-grouped shipment list for the Shipment Kanban board.
        Designed to be polled every 60 seconds; returns the current active-season
        operational shipments grouped by phase with per-shipment task aggregates
        pre-computed server-side so the client never N+1s.

        Response shape:
            {
                "phases": ["PLAN", "PREP", "DOCS", "LOAD", "TRANSIT", "DEST", "CLOSE"],
                "columns": {
                    "PREP": [BoardItemSerializer, ...],
                    "DOCS": [...],
                    ...
                },
                "phase_avg_seconds": {"PREP": null, "LOAD": 2400, ...}
            }

        Query params (all optional):
            ?country=<id>         — filter by country FK
            ?customer=<id>        — filter by customer FK
            ?gapy_satys=true|false — filter by is_gapy_satys
            ?owner_role=<role>    — keep only shipments whose most-recent task
                                    assignee_role matches
            ?search=<text>        — cargo_code icontains

        assertNumQueries constraint: ≤ 8 queries regardless of result size.
        This is enforced by the bounded-query test in tests_shipment_board.py.
        """
        from django.core.cache import cache
        from apps.export.models import Task as _Task
        from apps.export.serializers import BoardItemSerializer
        from apps.export.services.phases import PHASE_ORDER, get_phase

        # ── Build the base queryset ────────────────────────────────────────────
        # Always scope to active season, non-archived. These conditions mirror
        # the intent of the Kanban: show live operational work only.
        qs = (
            Shipment.objects.filter(
                season__is_active=True,
                is_archived=False,
            )
            .select_related('status', 'country', 'customer')
        )

        # ── Apply request filters ─────────────────────────────────────────────
        country_id = request.query_params.get('country')
        if country_id:
            qs = qs.filter(country_id=country_id)

        customer_id = request.query_params.get('customer')
        if customer_id:
            qs = qs.filter(customer_id=customer_id)

        gapy_param = request.query_params.get('gapy_satys')
        if gapy_param is not None:
            qs = qs.filter(is_gapy_satys=(gapy_param.lower() in ('true', '1')))

        search_text = request.query_params.get('search', '').strip()
        if search_text:
            qs = qs.filter(cargo_code__icontains=search_text)

        # owner_role filter: keep only shipments whose most-recent task (by
        # created_at desc) has the given assignee_role. Uses a Subquery to
        # avoid cross-product duplication. Strip .order_by() is not needed
        # here because Task has no Meta.ordering, but we specify it explicitly
        # for clarity. No Window function involved, so mssql-compat subquery
        # ordering restriction does not apply.
        owner_role = request.query_params.get('owner_role', '').strip()
        if owner_role:
            # Keep only shipments whose most-recent task (by created_at desc)
            # has the given assignee_role. Subquery approach is safe for MSSQL
            # — no Window involved so no Meta.ordering-in-subquery issue.
            latest_task_role_sq = (
                _Task.objects.filter(shipment=OuterRef('pk'))
                .order_by('-created_at')
                .values('assignee_role')[:1]
            )
            qs = qs.annotate(_latest_role=Subquery(latest_task_role_sq))
            qs = qs.filter(_latest_role=owner_role)

        # ── Task-count annotations ────────────────────────────────────────────
        # All counts are done as filtered COUNT(*) on the tasks relation.
        # Django translates these to a single SQL query with conditional
        # COUNT expressions (no per-row subqueries) on MSSQL.
        qs = qs.annotate(
            tasks_total=Count('tasks'),
            tasks_done=Count('tasks', filter=Q(tasks__state='done')),
            late_count=Count(
                'tasks',
                filter=Q(tasks__deadline__lt=Now())
                & ~Q(tasks__state__in=['done', 'cancelled']),
            ),
            in_progress_count=Count(
                'tasks', filter=Q(tasks__state='in_progress'),
            ),
            blocked_count=Count(
                'tasks', filter=Q(tasks__state='blocked'),
            ),
        )

        # ── Prefetch tasks (for owner_role resolution in the serializer) ──────
        tasks_prefetch = Prefetch(
            'tasks',
            queryset=_Task.objects.order_by('-created_at'),
        )
        # ── Prefetch status_log (for time_in_phase_seconds phase-entry walk) ──
        # resolve_phase_entry() reads status_log.all() with .status.code on
        # each entry. Without this prefetch, that becomes N+1 queries.
        # select_related('status') is required on the inner queryset so the
        # status.code access on each log entry doesn't trigger additional DB hits.
        from apps.export.models import ShipmentStatusLog as _StatusLog
        status_log_prefetch = Prefetch(
            'status_log',
            queryset=_StatusLog.objects.select_related('status').order_by('-changed_at'),
        )
        qs = qs.prefetch_related(tasks_prefetch, status_log_prefetch)

        # ── Evaluate and group by phase ───────────────────────────────────────
        columns: dict[str, list] = {phase: [] for phase in PHASE_ORDER}
        for shipment in qs:
            phase = get_phase(shipment.status.code if shipment.status_id else None)
            columns[phase].append(shipment)

        # Sort within each column: late first → in_progress → idle, by
        # time_in_phase_seconds descending (oldest-in-phase at top).
        # Use status_changed_at (set by transition_to) as the sort key;
        # fall back to updated_at for shipments that pre-date the new field.
        now = timezone.now()
        for phase_items in columns.values():
            phase_items.sort(
                key=lambda s: (
                    -(s.late_count or 0),
                    -(s.in_progress_count or 0),
                    -int(
                        (now - (
                            s.status_changed_at or s.updated_at or now
                        )).total_seconds()
                    ),
                )
            )

        # ── Serialize columns ────────────────────────────────────────────────
        serialized_columns = {
            phase: BoardItemSerializer(items, many=True).data
            for phase, items in columns.items()
        }

        # ── phase_avg_seconds (cached 5 min per active season) ───────────────
        # Derive from AD-1 denormalized timestamps on recently-closed shipments.
        # Phase → AD-1 timestamp pair used to compute average duration:
        #   LOAD    = avg(customs_entry_at - loading_started_at)
        #   DOCS    = avg(departed_at      - customs_entry_at)
        #   TRANSIT = avg(arrived_at       - departed_at)
        #   DEST    = avg(sale_ended_at    - arrived_at)
        # PLAN, PREP, CLOSE: no AD-1 pair available → null.
        # Values are cached per active season for 5 minutes.
        active_season_id = (
            Shipment.objects.filter(season__is_active=True)
            .values_list('season_id', flat=True)
            .first()
        )
        cache_key = f'board:phase_avgs:{active_season_id}'
        phase_avg_seconds = cache.get(cache_key)
        if phase_avg_seconds is None:
            phase_avg_seconds = self._compute_phase_avg_seconds(active_season_id)
            cache.set(cache_key, phase_avg_seconds, 300)

        return Response({
            'phases': PHASE_ORDER,
            'columns': serialized_columns,
            'phase_avg_seconds': phase_avg_seconds,
        })

    @staticmethod
    def _compute_phase_avg_seconds(season_id: int | None) -> dict:
        """Compute average seconds per phase for closed shipments in the last 30 days.

        Uses AD-1 denormalized timestamp pairs. Only computes phases that have
        a start + end AD-1 timestamp. Returns None for phases with no data.

        Phase → (start_field, end_field) pairs:
            LOAD    loading_started_at → customs_entry_at
            DOCS    customs_entry_at   → departed_at
            TRANSIT departed_at        → arrived_at
            DEST    arrived_at         → sale_ended_at

        Phases without AD-1 coverage (PLAN, PREP, CLOSE) always return None.
        """
        import datetime as dt
        from django.utils import timezone as _tz

        thirty_days_ago = _tz.now() - dt.timedelta(days=30)

        filter_kwargs: dict = {'is_archived': False}
        if season_id:
            filter_kwargs['season_id'] = season_id

        # Fetch the timestamp columns for closed or late-stage shipments.
        # We pull only the 4 pairs we need to avoid over-fetching.
        rows = list(
            Shipment.objects.filter(**filter_kwargs)
            .filter(loading_started_at__gte=thirty_days_ago)
            .values(
                'loading_started_at',
                'customs_entry_at',
                'departed_at',
                'arrived_at',
                'sale_ended_at',
            )
        )

        # Phase → list of durations in seconds
        phase_durations: dict[str, list[float]] = {
            'LOAD': [],
            'DOCS': [],
            'TRANSIT': [],
            'DEST': [],
        }

        for row in rows:
            pairs = [
                ('LOAD',    row['loading_started_at'], row['customs_entry_at']),
                ('DOCS',    row['customs_entry_at'],   row['departed_at']),
                ('TRANSIT', row['departed_at'],        row['arrived_at']),
                ('DEST',    row['arrived_at'],         row['sale_ended_at']),
            ]
            for phase_key, t_start, t_end in pairs:
                if t_start and t_end and t_end > t_start:
                    phase_durations[phase_key].append((t_end - t_start).total_seconds())

        result: dict[str, int | None] = {phase: None for phase in ['PLAN', 'PREP', 'DOCS', 'LOAD', 'TRANSIT', 'DEST', 'CLOSE']}
        for phase_key, durations in phase_durations.items():
            if durations:
                result[phase_key] = int(sum(durations) / len(durations))

        return result


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

    @staticmethod
    def _build_mention_users_map(comments) -> dict:
        """Resolve every @user mention across a page of comments in ONE query.

        `mentions_ids` is parsed from comment text (not an FK relation), so it
        can't be prefetch_related'd. Gathering the union of ids for the page and
        resolving them once turns the serializer's per-comment lookup into a
        single query — avoiding N+1 on the comments list.
        """
        from apps.core.models import User

        all_ids: set[int] = set()
        for comment in comments:
            all_ids.update(comment.mentions_ids or [])
        if not all_ids:
            return {}
        users = User.objects.filter(id__in=all_ids).only(
            'id', 'username', 'first_name', 'last_name', 'role',
        )
        return {u.id: CommentSerializer.user_chip(u) for u in users}

    def paginate_queryset(self, queryset):
        # Called during list() before the serializer is built. Capture the page
        # and pre-resolve its mentioned users so get_serializer_context can hand
        # the map to the serializer (see _build_mention_users_map).
        page = super().paginate_queryset(queryset)
        if page is not None:
            # Per-request state: DRF builds a fresh viewset instance per request
            # (as_view().dispatch()), so stashing on self is safe here.
            self._mention_users_map = self._build_mention_users_map(page)
        return page

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        mention_map = getattr(self, '_mention_users_map', None)
        if mention_map is not None:
            ctx['mention_users_map'] = mention_map
        return ctx

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


class TaskViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only listing/retrieval of Tasks plus action endpoints for state changes.

    Tasks are NOT created via POST — generation is owned by the rule engine
    (services/task_rules.generate_tasks_for_status). Manual ad-hoc tasks are a
    future feature and not part of this PR.

    GET    /api/v1/export/tasks/            — paginated task list
    GET    /api/v1/export/tasks/{id}/       — task detail
    POST   /api/v1/export/tasks/{id}/start/     — OPEN → IN_PROGRESS
    POST   /api/v1/export/tasks/{id}/block/     — → BLOCKED (with reason)
    POST   /api/v1/export/tasks/{id}/unblock/   — BLOCKED → IN_PROGRESS
    POST   /api/v1/export/tasks/{id}/complete/  — → DONE (manual_done only)
    POST   /api/v1/export/tasks/{id}/cancel/    — → CANCELLED (admin/director only)
    """

    permission_classes = [IsAuthenticated]
    filterset_fields = ['assignee_role', 'assignee_user', 'state', 'shipment', 'step']

    def get_queryset(self):
        from apps.export.models import Task, TaskState

        qs = Task.objects.select_related('shipment__status', 'rule', 'assignee_user').all()

        # `?overdue=true` filter: deadline < now AND state NOT IN (DONE, CANCELLED)
        if self.request.query_params.get('overdue') == 'true':
            qs = qs.filter(
                deadline__lt=timezone.now(),
            ).exclude(state__in=[TaskState.DONE, TaskState.CANCELLED])

        return qs.order_by('deadline', 'created_at')

    def get_serializer_class(self):
        from apps.export.serializers import TaskDetailSerializer, TaskListSerializer
        return TaskDetailSerializer if self.action == 'retrieve' else TaskListSerializer

    def _check_task_actor_permission(self, request, task, action_name: str):
        """Return a 403 Response if the caller may not perform action_name on task.

        Returns None if permission is granted.
        """
        from apps.export.permissions import IsTaskActor

        perm = IsTaskActor()
        # Temporarily set the view's action so has_object_permission can branch on it
        original_action = self.action
        self.action = action_name
        try:
            allowed = perm.has_object_permission(request, self, task)
        finally:
            self.action = original_action

        if not allowed:
            return Response(
                {'error': f"Role '{getattr(request.user, 'role', None)}' "
                          f"cannot perform '{action_name}' on this task."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        """POST /api/v1/export/tasks/{id}/start/

        Transitions a task from OPEN to IN_PROGRESS. Sets started_at if not
        already set. Idempotent: if already IN_PROGRESS, returns 200 with no change.

        Permission: assignee_role or supervisor roles.
        """
        from apps.export.models import Task, TaskState
        from apps.export.serializers import TaskDetailSerializer

        task = self.get_object()

        denied = self._check_task_actor_permission(request, task, 'start')
        if denied:
            return denied

        if task.state == TaskState.IN_PROGRESS:
            # Idempotent — already started
            return Response(TaskDetailSerializer(task).data)

        if task.state != TaskState.OPEN:
            # BLOCKED tasks must be unblocked first; DONE/CANCELLED can't be (re)started.
            # The dedicated /unblock/ endpoint clears blocked_reason and is the documented
            # recovery path — start should not silently bypass it.
            return Response(
                {'error': f"Cannot start a task in state '{task.state}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        task.state = TaskState.IN_PROGRESS
        if not task.started_at:
            task.started_at = now
        task.save(update_fields=['state', 'started_at'])

        task.refresh_from_db()
        return Response(TaskDetailSerializer(task).data)

    @action(detail=True, methods=['post'])
    def block(self, request, pk=None):
        """POST /api/v1/export/tasks/{id}/block/

        Transitions a task to BLOCKED and records the reason.

        Request body: { "reason": "string (required, max 500)" }
        Permission: assignee_role or supervisor roles.
        """
        from apps.export.models import TaskState
        from apps.export.serializers import TaskBlockSerializer, TaskDetailSerializer

        task = self.get_object()

        denied = self._check_task_actor_permission(request, task, 'block')
        if denied:
            return denied

        block_serializer = TaskBlockSerializer(data=request.data)
        if not block_serializer.is_valid():
            return Response(block_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        reason = block_serializer.validated_data['reason']

        if task.state == TaskState.DONE:
            return Response(
                {'error': 'Cannot block a completed task.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if task.state == TaskState.CANCELLED:
            return Response(
                {'error': 'Cannot block a cancelled task.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task.state = TaskState.BLOCKED
        task.blocked_reason = reason
        task.save(update_fields=['state', 'blocked_reason'])

        task.refresh_from_db()
        return Response(TaskDetailSerializer(task).data)

    @action(detail=True, methods=['post'])
    def unblock(self, request, pk=None):
        """POST /api/v1/export/tasks/{id}/unblock/

        Transitions a BLOCKED task back to IN_PROGRESS.

        Permission: assignee_role or supervisor roles.
        """
        from apps.export.models import TaskState
        from apps.export.serializers import TaskDetailSerializer

        task = self.get_object()

        denied = self._check_task_actor_permission(request, task, 'unblock')
        if denied:
            return denied

        if task.state != TaskState.BLOCKED:
            return Response(
                {'error': f"Task is in state '{task.state}', not 'blocked'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task.state = TaskState.IN_PROGRESS
        task.blocked_reason = ''
        task.save(update_fields=['state', 'blocked_reason'])

        task.refresh_from_db()
        return Response(TaskDetailSerializer(task).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """POST /api/v1/export/tasks/{id}/complete/

        Manually marks a MANUAL_DONE task as DONE. Returns 400 for tasks
        with auto-resolution completion rules (ALL_FIELDS_FILLED, ANY_FIELD_FILLED)
        because those resolve automatically via Shipment.save() — explicit
        "mark done" does not apply to them.

        Permission: assignee_role or supervisor roles.
        """
        from apps.export.models import TaskState, TaskCompletionRule
        from apps.export.serializers import TaskDetailSerializer

        task = self.get_object()

        denied = self._check_task_actor_permission(request, task, 'complete')
        if denied:
            return denied

        if task.completion_rule != TaskCompletionRule.MANUAL_DONE:
            return Response(
                {
                    'error': (
                        f"Task completion_rule is '{task.completion_rule}', not 'manual_done'. "
                        f"This task auto-resolves when its target fields are filled — "
                        f"use the shipment PATCH endpoint to fill the required fields."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if task.state == TaskState.DONE:
            # Idempotent — already done
            return Response(TaskDetailSerializer(task).data)

        if task.state == TaskState.CANCELLED:
            return Response(
                {'error': 'Cannot complete a cancelled task.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        task.state = TaskState.DONE
        task.completed_at = now
        if not task.started_at:
            task.started_at = now
        task.save(update_fields=['state', 'completed_at', 'started_at'])

        task.refresh_from_db()
        return Response(TaskDetailSerializer(task).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """POST /api/v1/export/tasks/{id}/cancel/

        Cancels a task. Restricted to admin/director only.
        """
        from apps.export.models import TaskState
        from apps.export.serializers import TaskDetailSerializer

        task = self.get_object()

        denied = self._check_task_actor_permission(request, task, 'cancel')
        if denied:
            return denied

        if task.state == TaskState.CANCELLED:
            # Idempotent
            return Response(TaskDetailSerializer(task).data)

        task.state = TaskState.CANCELLED
        task.save(update_fields=['state'])

        task.refresh_from_db()
        return Response(TaskDetailSerializer(task).data)
