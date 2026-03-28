import logging
from decimal import Decimal

from django.db.models import Count, DecimalField, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import PRIVILEGED_ROLES
from apps.export.models import FinansistAdvance, FinansistAdvanceShipment, Shipment
from apps.export.serializers import (
    FinansistAdvanceCreateSerializer,
    FinansistAdvanceDetailSerializer,
    FinansistAdvanceListSerializer,
)

logger = logging.getLogger(__name__)

# Roles that may create or reconcile advances
_ADVANCE_WRITE_ROLES: frozenset[str] = frozenset({'finansist'}) | PRIVILEGED_ROLES


class FinansistAdvanceViewSet(ModelViewSet):
    """
    GET    /api/v1/export/advances/                               — list all advances
    GET    /api/v1/export/advances/{id}/                          — detail with linked shipments
    POST   /api/v1/export/advances/                               — create new advance (finansist)
    PATCH  /api/v1/export/advances/{id}/reconcile/                — mark as reconciled
    POST   /api/v1/export/advances/{id}/link-shipment/            — link a shipment to this advance
    DELETE /api/v1/export/advances/{id}/unlink-shipment/{sid}/    — remove a shipment link
    """

    permission_classes = [IsAuthenticated]
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
        return qs

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return FinansistAdvanceDetailSerializer
        if self.action in ('link_shipment', 'unlink_shipment', 'reconcile'):
            return FinansistAdvanceDetailSerializer
        return FinansistAdvanceListSerializer

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

        if not Shipment.objects.filter(id=shipment_id).exists():
            return Response(
                {'error': f'Shipment {shipment_id} not found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
