import logging
from django.db.models import QuerySet
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.export.models import Shipment
from apps.export.serializers import ShipmentListSerializer, ShipmentDetailSerializer
from apps.export.services import transition_to

logger = logging.getLogger(__name__)

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

    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'head', 'options']  # no PUT/PATCH/DELETE via API

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

        # Role check: target status required_role must match requesting user's role.
        # export_manager and director can trigger any transition.
        from apps.core.models import ShipmentStatusType
        try:
            target_status = ShipmentStatusType.objects.get(code=new_status_code)
        except ShipmentStatusType.DoesNotExist:
            return Response({'error': f'Unknown status: {new_status_code}'}, status=status.HTTP_400_BAD_REQUEST)

        privileged_roles = {'export_manager', 'director'}
        user_role = getattr(request.user, 'role', None)
        required_role = target_status.required_role
        if required_role and user_role not in privileged_roles and user_role != required_role:
            return Response(
                {'error': f'Role {user_role!r} cannot trigger transition to {new_status_code!r}'},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            transition_to(shipment, new_status_code, request.user, comment)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        serializer = ShipmentDetailSerializer(shipment, context={'request': request})
        return Response(serializer.data)
