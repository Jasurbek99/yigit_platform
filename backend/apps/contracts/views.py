"""ViewSets for the contracts app."""
import logging

from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import write_permission
from apps.contracts.models import Contract
from apps.contracts.serializers import (
    ContractCreateSerializer,
    ContractDetailSerializer,
    ContractListSerializer,
)

logger = logging.getLogger(__name__)

# Roles allowed to create and modify contracts.
_CONTRACT_WRITE_ROLES = ('export_manager', 'director', 'admin')


class ContractViewSet(ModelViewSet):
    """CRUD ViewSet for contracts.

    List / retrieve: any authenticated user.
    Create / update: export_manager, director, admin only.

    Default queryset excludes 'cancelled' contracts. Pass ``?status=`` to
    filter by a specific status (but 'cancelled' is never returned).
    Pass ``?include_ended=true`` to include 'completed' and 'closed' alongside
    'active' contracts.
    """

    permission_classes = [IsAuthenticated, write_permission(*_CONTRACT_WRITE_ROLES)]

    def get_queryset(self):
        """Return contracts queryset filtered by status.

        Default: only 'active' contracts.
        ?include_ended=true: 'active' + 'completed' + 'closed'.
        ?status=<value>: exact match (cancelled still excluded).

        'cancelled' is NEVER returned by the list endpoint regardless of params.
        """
        qs = Contract.objects.select_related(
            'export_firm', 'import_firm', 'season', 'customer', 'created_by',
        )

        status_param = self.request.query_params.get('status')
        include_ended = self.request.query_params.get('include_ended', '').lower() == 'true'

        if status_param:
            # Explicit ?status= filter — still block cancelled
            if status_param == Contract.STATUS_CANCELLED:
                return qs.none()
            qs = qs.filter(status=status_param)
        elif include_ended:
            qs = qs.filter(
                status__in=[
                    Contract.STATUS_ACTIVE,
                    Contract.STATUS_COMPLETED,
                    Contract.STATUS_CLOSED,
                ]
            )
        else:
            qs = qs.filter(status=Contract.STATUS_ACTIVE)

        # Optional FK filters
        season_id = self.request.query_params.get('season')
        if season_id:
            qs = qs.filter(season_id=season_id)

        export_firm_id = self.request.query_params.get('export_firm')
        if export_firm_id:
            qs = qs.filter(export_firm_id=export_firm_id)

        import_firm_id = self.request.query_params.get('import_firm')
        if import_firm_id:
            qs = qs.filter(import_firm_id=import_firm_id)

        return qs

    def get_serializer_class(self):
        """Use the appropriate serializer for each action."""
        if self.action == 'list':
            return ContractListSerializer
        if self.action in ('create', 'partial_update', 'update'):
            return ContractCreateSerializer
        # retrieve → full detail
        return ContractDetailSerializer
