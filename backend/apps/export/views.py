import logging

from django.db import transaction
from django.db.models import (
    Exists,
    OuterRef,
    Q,
    QuerySet,
)
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.core.permission_registry import ROLE_REQUIRED_FIELDS
from apps.core.permissions import PRIVILEGED_ROLES, DynamicResourcePermission
from apps.export.models import (
    QualityDocument, QuotaUsageRecord, SalesReport, Shipment, ShipmentComment,
    ShipmentBlockSource, ShipmentFirmSplit, get_default_truck_weight,
)
from apps.export.serializers import (
    QualityDocumentSerializer,
    OverdueShipmentSerializer,
    SalesReportSerializer,
    ShipmentAssignSerializer,
    ShipmentCreateSerializer,
    ShipmentListSerializer,
    ShipmentDetailSerializer,
    ShipmentSheetSerializer,
    CommentSerializer,
    ShipmentPatchSerializer,
)
from apps.export.services import create_shipment, transition_to

logger = logging.getLogger(__name__)

# Status codes for the SALES phase (steps 9-11) — shipments that have arrived
# but haven't reached hasabat yet. Used by the overdue endpoint.
SALES_PHASE_CODES = ['bardy', 'satylyar', 'satyldy']

# Maps user role to shipment status phases visible under "my work" filter.
# Phase values match ShipmentStatusType.phase in the DB.
ROLE_PHASE_MAP = {
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

    filterset_fields = ['status', 'country', 'season', 'is_gapy_satys']
    search_fields = ['cargo_code']

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ShipmentDetailSerializer
        return ShipmentListSerializer

    def get_queryset(self) -> QuerySet:
        qs = super().get_queryset()
        # pending_my_fields takes priority over my_work when both are present.
        if self.request.query_params.get('pending_my_fields') == 'true':
            qs = self._filter_pending_fields(qs)
        elif self.request.query_params.get('my_work') == 'true':
            qs = self._filter_my_work(qs)
        if phase := self.request.query_params.get('phase'):
            qs = qs.filter(status__phase=phase)
        if status_code := self.request.query_params.get('status_code'):
            qs = qs.filter(status__code=status_code)
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
        """
        shipment = self.get_object()
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

        serializer.save()
        # Reload from DB so computed fields (auto_now timestamps, DB defaults) are fresh.
        instance = serializer.instance
        instance.refresh_from_db()
        logger.info(
            'Shipment %s patched fields %s by %s',
            instance.cargo_code,
            list(request.data.keys()),
            request.user.username,
        )
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
            )
            .filter(**season_filter)
            .order_by('-date', '-id')
        )

        serializer = ShipmentSheetSerializer(qs, many=True)
        return Response(serializer.data)

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

        Request body:
            { "content": "Some comment text" }

        Returns updated comments list on success.
        """
        shipment = self.get_object()
        content = request.data.get('content', '').strip()

        if not content:
            return Response({'error': 'content is required'}, status=status.HTTP_400_BAD_REQUEST)

        ShipmentComment.objects.create(
            shipment=shipment,
            user=request.user,
            content=content,
            is_system=False,
        )

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
        """
        shipment = self.get_object()
        blocks_data = request.data.get('blocks', [])

        if not isinstance(blocks_data, list):
            return Response(
                {'error': 'blocks must be a list'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        shipment.block_sources.all().delete()
        rows = [
            ShipmentBlockSource(
                shipment=shipment,
                block_id=entry.get('block_id'),
                weight_kg=entry.get('weight_kg', 0),
            )
            for entry in blocks_data
            if entry.get('block_id')
        ]
        if rows:
            ShipmentBlockSource.objects.bulk_create(rows, batch_size=500)

        logger.info(
            'Block sources for %s updated by %s (%d blocks)',
            shipment.cargo_code, request.user.username, len(blocks_data),
        )
        return Response({'status': 'ok', 'count': len(blocks_data)})

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

            shipment.firm_splits.all().delete()
            split_rows = [
                ShipmentFirmSplit(
                    shipment=shipment,
                    export_firm_id=entry.get('export_firm_id'),
                    weight_kg=entry.get('weight_kg', 0),
                    split_order=i + 1,
                )
                for i, entry in enumerate(firms_data)
                if entry.get('export_firm_id')
            ]
            if split_rows:
                ShipmentFirmSplit.objects.bulk_create(split_rows, batch_size=500)

            # Auto-create quota usage records (draft) for each firm split
            shipment.quota_usage_records.filter(status='draft').delete()
            num_firms = len(split_rows)
            if num_firms > 0:
                default_kg = get_default_truck_weight(num_firms)
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
