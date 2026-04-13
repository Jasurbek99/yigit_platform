import logging

from django.db.models import (
    Exists,
    OuterRef,
    QuerySet,
)
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import PRIVILEGED_ROLES, DynamicResourcePermission
from apps.export.models import (
    QualityDocument, SalesReport, Shipment, ShipmentComment,
    ShipmentBlockSource, ShipmentFirmSplit,
)
from apps.export.serializers import (
    QualityDocumentSerializer,
    OverdueShipmentSerializer,
    SalesReportSerializer,
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
    'finansist': ['SALES', 'COMPLETE'],
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
        'status', 'country', 'customer', 'season',
    ).order_by('-date', '-id')

    filterset_fields = ['status', 'country', 'season', 'is_gapy_satys']
    search_fields = ['cargo_code']

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ShipmentDetailSerializer
        return ShipmentListSerializer

    def get_queryset(self) -> QuerySet:
        qs = super().get_queryset()
        if self.request.query_params.get('my_work') == 'true':
            qs = self._filter_my_work(qs)
        if phase := self.request.query_params.get('phase'):
            qs = qs.filter(status__phase=phase)
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

        qs = (
            self.get_queryset()
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

        Returns ALL shipments for the active season with full sheet fields.
        No pagination — the frontend spreadsheet view needs all records at once.

        Applies the same my_work / phase filters as the list endpoint when those
        query params are present, so the sheet can be scoped by role if needed.
        """
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
            .filter(season__is_active=True)
            .order_by('-date', '-id')
        )

        serializer = ShipmentSheetSerializer(qs, many=True)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        """POST /api/v1/export/shipments/

        Creates a new shipment record at step 1 (yuklenme).
        Only export_manager and director roles may create shipments.
        Returns full shipment detail on success with HTTP 201.
        """
        if getattr(request.user, 'role', None) not in PRIVILEGED_ROLES:
            return Response(
                {'error': 'Only export_manager or director can create shipments'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = ShipmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

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
        for entry in blocks_data:
            block_id = entry.get('block_id')
            weight_kg = entry.get('weight_kg', 0)
            if block_id:
                ShipmentBlockSource.objects.create(
                    shipment=shipment,
                    block_id=block_id,
                    weight_kg=weight_kg,
                )

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

        shipment.firm_splits.all().delete()
        for i, entry in enumerate(firms_data):
            firm_id = entry.get('export_firm_id')
            weight_kg = entry.get('weight_kg', 0)
            if firm_id:
                ShipmentFirmSplit.objects.create(
                    shipment=shipment,
                    export_firm_id=firm_id,
                    weight_kg=weight_kg,
                    split_order=i + 1,
                )

        logger.info(
            'Firm splits for %s updated by %s (%d firms)',
            shipment.cargo_code, request.user.username, len(firms_data),
        )
        return Response({'status': 'ok', 'count': len(firms_data)})
