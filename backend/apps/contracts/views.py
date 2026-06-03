"""ViewSets for the contracts app."""
import logging

from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import write_permission
from apps.contracts.models import Contract, Invoice
from apps.contracts.serializers import (
    ContractCreateSerializer,
    ContractDetailSerializer,
    ContractListSerializer,
    InvoiceCreateSerializer,
    InvoiceDetailSerializer,
    InvoiceListSerializer,
)

logger = logging.getLogger(__name__)

# Roles allowed to create and modify contracts and invoices.
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


class InvoiceViewSet(ModelViewSet):
    """CRUD ViewSet for invoices.

    List / retrieve: any authenticated user.
    Create / update: export_manager, director, admin only.
    Delete: admin / superuser only — rollback is too easy to mess up otherwise.

    Supports filters:
      ?contract=<id>  — only invoices for a specific contract
      ?status=<code>  — filter by invoice status (draft|sent|paid|void)
    """

    queryset = Invoice.objects.select_related(
        'contract',
        'shipment',
        'export_firm',
        'import_firm',
    )

    def get_queryset(self):
        """Apply optional contract and status filters."""
        qs = super().get_queryset()

        contract_id = self.request.query_params.get('contract')
        if contract_id:
            qs = qs.filter(contract_id=contract_id)

        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)

        return qs

    def get_serializer_class(self):
        """Use the appropriate serializer for each action."""
        if self.action == 'list':
            return InvoiceListSerializer
        if self.action in ('create', 'update', 'partial_update'):
            return InvoiceCreateSerializer
        return InvoiceDetailSerializer

    def get_permissions(self):
        """Permission matrix:
        - DELETE: admin/superuser only
        - CREATE/UPDATE: export_manager, director, admin
        - READ: any authenticated user
        """
        if self.action == 'destroy':
            return [IsAuthenticated(), write_permission('admin')()]
        if self.action in ('create', 'update', 'partial_update'):
            return [IsAuthenticated(), write_permission(*_CONTRACT_WRITE_ROLES)()]
        return [IsAuthenticated()]
