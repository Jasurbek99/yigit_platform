"""ViewSets for the contracts app."""
import logging
from decimal import Decimal

from django.http import FileResponse, HttpResponse
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import DynamicResourcePermission, write_permission
from apps.contracts.document_templates.registry import SCOPE_INVOICE, get_spec
from apps.contracts.models import Contract, ContractAttachment, ContractSale
from apps.contracts.serializers import (
    ContractAttachmentSerializer,
    ContractCreateSerializer,
    ContractDetailSerializer,
    ContractListSerializer,
    ContractSaleCreateSerializer,
    ContractSaleDetailSerializer,
    ContractSaleListSerializer,
)
from apps.contracts.services.document_render import DocumentRenderError, generate
from apps.contracts.services.files import (
    MAX_FILES_PER_CONTRACT,
    sanitise_filename,
    validate_contract_document,
)

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
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        """Return contracts queryset filtered by status.

        Default: only 'active' contracts.
        ?include_ended=true: 'active' + 'completed' + 'closed'.
        ?status=<value>: exact match (cancelled still excluded).

        'cancelled' is NEVER returned by the list endpoint regardless of params.

        Status / FK filtering applies to the **list** action only. Detail and the
        attachment actions (retrieve, upload/download/delete) resolve by pk across
        every status — contract documents are legal records still needed after the
        contract is completed or closed.
        """
        qs = Contract.objects.select_related(
            'export_firm', 'import_firm', 'season', 'customer', 'created_by',
        )
        if self.action == 'retrieve':
            qs = qs.prefetch_related('attachments__uploaded_by')

        if self.action != 'list':
            return qs

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

    @action(detail=True, methods=['post'], url_path='attachments')
    def upload_attachment(self, request, pk=None):
        """Upload one or more PDF documents to this contract.

        Multipart files are read from the ``files`` form key. Each file is
        validated (size, .pdf extension, %PDF magic bytes) before any DB write.
        POST is gated by the contract resource's ``can_create`` permission.
        Returns the contract's full attachment list on success.
        """
        contract = self.get_object()
        files = request.FILES.getlist('files')

        if not files:
            return Response({'error': 'No files provided.'}, status=400)

        existing = contract.attachments.count()
        if existing + len(files) > MAX_FILES_PER_CONTRACT:
            return Response(
                {'error': f'Maximum {MAX_FILES_PER_CONTRACT} documents allowed per contract.'},
                status=400,
            )

        # Validate every file before persisting any of them
        for f in files:
            validate_contract_document(f)

        created = [
            ContractAttachment.objects.create(
                contract=contract,
                file=f,
                original_filename=sanitise_filename(f.name),
                mime_type=f.content_type or 'application/pdf',
                size_bytes=f.size,
                uploaded_by=request.user,
            )
            for f in files
        ]
        data = ContractAttachmentSerializer(created, many=True).data
        return Response(data, status=201)

    @action(
        detail=True,
        methods=['delete'],
        url_path='attachments/(?P<att_id>[0-9]+)',
    )
    def delete_attachment(self, request, pk=None, att_id=None):
        """Delete a single contract document. Gated by ``can_delete``."""
        contract = self.get_object()
        attachment = contract.attachments.filter(pk=att_id).first()
        if attachment is None:
            return Response({'error': 'Attachment not found.'}, status=404)

        attachment.file.delete(save=False)
        attachment.delete()
        return Response(status=204)

    @action(
        detail=True,
        methods=['get'],
        url_path='attachments/(?P<att_id>[0-9]+)/download',
    )
    def download_attachment(self, request, pk=None, att_id=None):
        """Stream a contract document inline (PDF preview). Gated by ``can_view``."""
        contract = self.get_object()
        attachment = contract.attachments.filter(pk=att_id).first()
        if attachment is None:
            return Response({'error': 'Attachment not found.'}, status=404)

        response = FileResponse(
            attachment.file.open('rb'),
            content_type=attachment.mime_type or 'application/pdf',
            as_attachment=False,
            filename=attachment.original_filename,
        )
        return response


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
        'shipment__packing_preset',  # whole-truck packing (CMR + per-firm derivation)
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


_FIRM_OVERRIDE_FIELDS = ('gross_kg', 'box_count', 'pallet_count', 'pallet_weight_kg')


class ShipmentPackingView(APIView):
    """Unified per-truck packing view (the digital "gross net" row).

    You pick ONE whole-truck config (→ CMR). Each firm's packing is then DERIVED
    by splitting that config by the firm's weight share (→ that firm's Invoice), so
    the per-firm values always sum back to the truck — poka-yoke, no inconsistent
    split possible. NET per firm is the firm's own weight, never derived. Each firm
    field may be manually overridden; null = use the derived value.

    GET ?shipment=<id> → { whole_truck (config values), total_firm_weight,
        consistent (Σ weights == truck net), rows[] with derived + override }.
    POST { shipment, scope:'truck', packing_preset }  → set Shipment.packing_preset (null clears).
    POST { shipment, scope:'firm', export_firm, gross_kg?, box_count?, pallet_count?,
        pallet_weight_kg? }  → set/clear this firm's ContractSale overrides (null clears a field).

    Writes use `.update()` (no save() side effects). Lives in contracts (may read
    export). Reads open; writes gated to document-preparing roles.
    """

    permission_classes = [
        IsAuthenticated,
        write_permission('admin', 'director', 'export_manager', 'document_team'),
    ]

    def get(self, request):
        from apps.export.models import Shipment
        from apps.contracts.services.packing_split import derive_firm_packing

        shipment_id = request.query_params.get('shipment')
        if not shipment_id:
            return Response({'error': 'shipment query param is required.'}, status=400)
        shipment = (
            Shipment.objects.filter(pk=shipment_id)
            .select_related('packing_preset')
            .prefetch_related('firm_splits__export_firm', 'sales')
            .first()
        )
        if shipment is None:
            return Response({'error': 'Shipment not found.'}, status=404)

        sale_by_firm = {
            s.export_firm_id: s for s in shipment.sales.all() if s.export_firm_id is not None
        }
        splits = list(shipment.firm_splits.all())
        total_weight = sum((s.weight_kg for s in splits if s.weight_kg is not None), Decimal('0'))
        truck = shipment.packing_preset

        rows = []
        for split in splits:
            sale = sale_by_firm.get(split.export_firm_id)
            derived = derive_firm_packing(truck, split.weight_kg, total_weight or None)
            override = {
                f: (getattr(sale, f) if sale else None) for f in _FIRM_OVERRIDE_FIELDS
            }
            rows.append({
                'export_firm': split.export_firm_id,
                'export_firm_code': split.export_firm.code,
                'export_firm_name': split.export_firm.name_short or split.export_firm.name_tk,
                'weight_kg': split.weight_kg,
                'sale_id': sale.id if sale else None,
                'derived': derived,
                'override': override,
            })

        truck_net = truck.net_kg if truck else None
        consistent = (
            truck_net is not None and total_weight > 0 and Decimal(truck_net) == total_weight
        )
        return Response({
            'shipment': shipment.id,
            'whole_truck': {
                'packing_preset': truck.id if truck else None,
                'packing_preset_name': truck.name if truck else None,
                'net_kg': truck.net_kg if truck else None,
                'gross_kg': truck.gross_kg if truck else None,
                'box_count': truck.box_count if truck else None,
                'pallet_count': truck.pallet_count if truck else None,
                'pallet_weight_kg': truck.pallet_weight_kg if truck else None,
            },
            'total_firm_weight': total_weight,
            'consistent': consistent,
            'rows': rows,
        })

    def post(self, request):
        from apps.export.models import PackingPreset, Shipment
        from apps.contracts.models import ContractSale

        data = request.data
        shipment_id = data.get('shipment')
        if not Shipment.objects.filter(pk=shipment_id).exists():
            return Response({'error': 'Shipment not found.'}, status=404)

        scope = data.get('scope')
        if scope == 'truck':
            preset_id = data.get('packing_preset')
            if preset_id is not None and not PackingPreset.objects.filter(pk=preset_id).exists():
                return Response({'error': 'Unknown packing_preset.'}, status=400)
            Shipment.objects.filter(pk=shipment_id).update(packing_preset_id=preset_id)
            return Response({'scope': 'truck', 'packing_preset': preset_id})

        if scope == 'firm':
            sale = ContractSale.objects.filter(
                shipment_id=shipment_id, export_firm_id=data.get('export_firm'),
            ).first()
            if sale is None:
                return Response(
                    {'error': 'No sale linked for this firm — link a contract first.'},
                    status=400,
                )
            # Only the override fields present in the body are updated (null clears).
            updates = {f: data[f] for f in _FIRM_OVERRIDE_FIELDS if f in data}
            if updates:
                ContractSale.objects.filter(pk=sale.id).update(**updates)
            return Response({'scope': 'firm', 'export_firm': sale.export_firm_id,
                             'sale_id': sale.id, **updates})

        return Response({'error': "scope must be 'truck' or 'firm'."}, status=400)
