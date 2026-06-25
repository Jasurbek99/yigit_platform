"""ViewSets for the contracts app."""
import logging

from django.http import HttpResponse
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import DynamicResourcePermission
from apps.contracts.document_templates.registry import SCOPE_INVOICE, get_spec
from apps.contracts.models import Contract, ContractSale
from apps.contracts.serializers import (
    ContractCreateSerializer,
    ContractDetailSerializer,
    ContractListSerializer,
    ContractSaleCreateSerializer,
    ContractSaleDetailSerializer,
    ContractSaleListSerializer,
)
from apps.contracts.services.document_render import DocumentRenderError, generate

logger = logging.getLogger(__name__)


class ContractViewSet(ModelViewSet):
    """CRUD ViewSet for contracts.

    Access is gated by the dynamic permission matrix via ``resource_code =
    'contract'`` (RoleResourcePermission). Defaults (seed_permissions):
    view/create/edit/delete for admin, director, export_manager; view-only for
    boss; no access for other roles. Admins re-toggle per role in
    *Admin → Permissions → Resource Permissions*.

    Default queryset excludes 'cancelled' contracts. Pass ``?status=`` to
    filter by a specific status (but 'cancelled' is never returned).
    Pass ``?include_ended=true`` to include 'completed' and 'closed' alongside
    'active' contracts.
    """

    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    resource_code = 'contract'

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


class ContractSaleViewSet(ModelViewSet):
    """CRUD ViewSet for contract sales.

    Access is gated by the dynamic permission matrix via ``resource_code =
    'sale'`` (RoleResourcePermission). Defaults (seed_permissions):
    view/create/edit for admin, director, export_manager; **delete for admin
    only** (rollback is too easy to mess up — director/export_manager get
    view+create+edit, no delete); view-only for boss; no access for other roles.

    Standard PageNumberPagination (default 50, max 200 per project api-contract).

    Supports filters (all combinable, all server-side):
      ?contract=<id>             — only sales for a specific contract
      ?status=<code>             — filter by status (draft|sent|paid|void)
      ?export_firm=<id>          — filter by seller
      ?import_firm=<id>          — filter by buyer
      ?date_from=YYYY-MM-DD      — invoice_date >= this
      ?date_to=YYYY-MM-DD        — invoice_date <= this
      ?search=<text>             — icontains match on passport_sdelka and
                                   parent contract_number
    """

    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    resource_code = 'sale'

    queryset = ContractSale.objects.select_related(
        'contract',
        'shipment',
        'export_firm',
        'import_firm',
    ).order_by('-invoice_date', 'contract_id', 'invoice_number')

    def get_queryset(self):
        """Apply server-side filters."""
        qs = super().get_queryset()
        p = self.request.query_params

        contract_id = p.get('contract')
        if contract_id:
            qs = qs.filter(contract_id=contract_id)

        status_param = p.get('status')
        if status_param:
            qs = qs.filter(status=status_param)

        export_firm_id = p.get('export_firm')
        if export_firm_id:
            qs = qs.filter(export_firm_id=export_firm_id)

        import_firm_id = p.get('import_firm')
        if import_firm_id:
            qs = qs.filter(import_firm_id=import_firm_id)

        date_from = p.get('date_from')
        if date_from:
            qs = qs.filter(invoice_date__gte=date_from)

        date_to = p.get('date_to')
        if date_to:
            qs = qs.filter(invoice_date__lte=date_to)

        search = (p.get('search') or '').strip()
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(passport_sdelka__icontains=search)
                | Q(contract__contract_number__icontains=search)
            )

        return qs

    def get_serializer_class(self):
        """Use the appropriate serializer for each action."""
        if self.action == 'list':
            return ContractSaleListSerializer
        if self.action in ('create', 'update', 'partial_update'):
            return ContractSaleCreateSerializer
        return ContractSaleDetailSerializer

    @action(detail=True, methods=['get'], url_path='document')
    def document(self, request, pk=None):
        """Generate an invoice document (.docx or PDF) for this sale.

        Query params:
            type: registry key — defaults to ``invoice_ru`` (also ``invoice_en``).
            fmt:  ``docx`` (default) or ``pdf``. (Named ``fmt`` not ``format`` —
                  ``format`` is reserved by DRF content negotiation.)

        Returns the file as an attachment. PDF requires LibreOffice on the server;
        when absent it returns 503 with a clear message (the .docx path is fine).
        """
        invoice = self.get_object()
        doc_type = request.query_params.get('type', 'invoice_ru')
        fmt = request.query_params.get('fmt', 'docx')

        try:
            spec = get_spec(doc_type)
        except KeyError:
            return Response(
                {'error': f'Unknown document type: {doc_type}'}, status=400,
            )
        if spec.scope != SCOPE_INVOICE:
            return Response(
                {'error': f'Document {doc_type!r} is not an invoice document.'},
                status=400,
            )

        try:
            data, filename, content_type = generate(doc_type, invoice, fmt)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        except DocumentRenderError as exc:
            return Response({'error': str(exc)}, status=503)

        response = HttpResponse(data, content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


class ShipmentFirmContractsView(APIView):
    """Slice 4 — resolve/link each firm split of a shipment to a contract.

    GET ?shipment=<id>  → per firm split: weight/amount, the $10K hint, the
        already-linked contract (if any), and the active framework contracts of
        the (seller, buyer) pair to choose from.
    POST {shipment, export_firm, mode, contract_id?} → link the split to a
        framework contract (mode='framework', contract_id required) or create a
        one_time contract (mode='one_time'); returns the resulting contract.

    Gated by the 'sale' resource (view for GET, create for POST). Lives in
    contracts (which may read export); the export firm-split code never calls here.
    """

    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    resource_code = 'sale'

    def get(self, request):
        from apps.export.models import Shipment
        from apps.contracts.services.shipment_firm_contracts import (
            framework_contracts_for_pair,
            money_warning,
        )

        shipment_id = request.query_params.get('shipment')
        if not shipment_id:
            return Response({'error': 'shipment query param is required.'}, status=400)
        shipment = (
            Shipment.objects.filter(pk=shipment_id)
            .select_related('import_firm')
            .prefetch_related('firm_splits__export_firm', 'sales__contract')
            .first()
        )
        if shipment is None:
            return Response({'error': 'Shipment not found.'}, status=404)

        import_firm_id = shipment.import_firm_id
        linked_by_firm = {
            sale.export_firm_id: sale
            for sale in shipment.sales.all()
            if sale.export_firm_id is not None
        }

        rows = []
        for split in shipment.firm_splits.all():
            options = (
                list(
                    framework_contracts_for_pair(split.export_firm_id, import_firm_id)
                    .values('id', 'contract_number')
                )
                if import_firm_id
                else []
            )
            sale = linked_by_firm.get(split.export_firm_id)
            linked = None
            if sale is not None:
                linked = {
                    'contract_id': sale.contract_id,
                    'contract_number': sale.contract.contract_number,
                    'contract_type': sale.contract.contract_type,
                }
            rows.append({
                'export_firm': split.export_firm_id,
                'export_firm_code': split.export_firm.code,
                'export_firm_name': split.export_firm.name_short or split.export_firm.name_tk,
                'weight_kg': split.weight_kg,
                'amount_usd': split.amount_usd,
                'money_warning': money_warning(split.amount_usd),
                'framework_options': options,
                'linked': linked,
            })

        return Response({
            'shipment': shipment.id,
            'import_firm': import_firm_id,
            'import_firm_name': (
                shipment.import_firm.name_short or shipment.import_firm.name_company
                if shipment.import_firm_id else None
            ),
            'rows': rows,
        })

    def post(self, request):
        from apps.export.models import Shipment
        from apps.contracts.services.shipment_firm_contracts import (
            link_split_to_contract,
            money_warning,
        )

        data = request.data
        shipment = Shipment.objects.filter(pk=data.get('shipment')).first()
        if shipment is None:
            return Response({'error': 'Shipment not found.'}, status=404)

        try:
            sale = link_split_to_contract(
                shipment=shipment,
                export_firm_id=int(data['export_firm']),
                mode=data.get('mode'),
                contract_id=data.get('contract_id'),
                user=request.user,
            )
        except (KeyError, TypeError, ValueError) as exc:
            return Response({'error': str(exc)}, status=400)

        return Response({
            'export_firm': sale.export_firm_id,
            'contract_id': sale.contract_id,
            'contract_number': sale.contract.contract_number,
            'contract_type': sale.contract.contract_type,
            'money_warning': money_warning(sale.total_usd),
        }, status=201)
