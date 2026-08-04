"""ViewSets for the contracts app."""
import logging
from decimal import Decimal

from django.http import FileResponse, HttpResponse
from rest_framework.decorators import action
from rest_framework.generics import ListAPIView
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.core.permissions import (
    DynamicResourcePermission, SeasonNotClosed, write_permission,
)
from apps.core.seasons import SeasonScopedMixin, assert_season_open, resolve_season
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
    DocumentPacketSerializer,
)
from apps.contracts.services.document_context import (
    PACKING_REQUIRED_MESSAGE,
    missing_packing_fields,
    missing_packing_on,
)
from apps.contracts.services.document_render import (
    ZIP_CONTENT_TYPE,
    DocumentRenderError,
    generate,
    generate_packet_zip,
)
from apps.contracts.services.files import (
    MAX_FILES_PER_CONTRACT,
    sanitise_filename,
    validate_contract_document,
)

logger = logging.getLogger(__name__)


class ContractViewSet(SeasonScopedMixin, ModelViewSet):
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

    permission_classes = [IsAuthenticated, DynamicResourcePermission, SeasonNotClosed]
    resource_code = 'contract'
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def perform_create(self, serializer):
        # Write freeze (D1): CreateModelMixin never calls get_object(), so
        # the SeasonNotClosed object permission cannot fire on a create.
        self.assert_create_target_open(serializer)
        serializer.save()

    def get_queryset(self):
        """Return contracts queryset filtered by status.

        Default: only 'active' contracts.
        ?include_ended=true: 'active' + 'completed' + 'closed'.
        ?status=<value>: exact match (cancelled still excluded).

        'cancelled' is NEVER returned by the list endpoint regardless of params.

        Status / FK / season filtering applies to the **list** action only. Detail
        and the attachment actions (retrieve, upload/download/delete) resolve by pk
        across every status and every season — contract documents are legal records
        still needed after the contract is completed, closed, or its season ends.
        """
        qs = Contract.objects.select_related(
            'export_firm', 'import_firm', 'import_firm__country', 'season', 'customer',
            'created_by',
        )
        if self.action == 'retrieve':
            qs = qs.prefetch_related('attachments__uploaded_by')

        if self.action != 'list':
            return qs

        qs = self.apply_season_scope(qs)

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

        # Optional FK filters (?season= is applied by apply_season_scope above,
        # which — unlike the hand-written filter it replaces — rejects a closed
        # season the caller may not view.)
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

    @action(detail=True, methods=['get'], url_path='agreement')
    def agreement(self, request, pk=None):
        """Generate the bilingual TK/RU export contract (.docx or PDF).

        Query params:
            fmt: ``docx`` (default) or ``pdf``. (Named ``fmt`` not ``format`` —
                 ``format`` is reserved by DRF content negotiation.)
            buyer_director: buyer's director name, printed in the preamble and
                signature blocks. Defaults to the firm's ``ImportFirm.contact_person``
                ("Director's Full Name"); this param overrides it for one generation.
            delivery_deadline: shipping cut-off date ``YYYY-MM-DD`` (§2.6). The
                contract *validity* date (§8.1) comes from the contract's end_date.
            stamps: ``1``/``true`` to stamp the signature block with each firm's
                uploaded seal + signature (``director_seal`` / ``director_signature``
                on ExportFirm/ImportFirm). Omitted → a clean, unstamped draft.

        Gated by the contract resource's view permission. Returns the file as an
        attachment; PDF requires LibreOffice (503 with a clear message if absent).
        """
        contract = self.get_object()

        # KZ-specific template: its liability clauses (§4) name Kazakh customs
        # authorities, so it must not be emitted for a non-Kazakhstan buyer.
        buyer = contract.import_firm
        country_code = getattr(getattr(buyer, 'country', None), 'code', None)
        if country_code != 'KZ':
            return Response(
                {'error': 'This contract template is for Kazakhstan buyers only.'},
                status=400,
            )

        fmt = request.query_params.get('fmt', 'docx')
        overrides = {
            key: value
            for key in ('buyer_director', 'delivery_deadline', 'stamps')
            if (value := request.query_params.get(key, '').strip())
        }

        try:
            data, filename, content_type = generate('contract_kz', contract, fmt, overrides)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        except DocumentRenderError as exc:
            return Response({'error': str(exc)}, status=503)

        response = HttpResponse(data, content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

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


class ContractSaleViewSet(SeasonScopedMixin, ModelViewSet):
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

    List is scoped to the resolved season via `shipment`. ContractSale.shipment
    is nullable — legacy 2-Sales rows imported before the shipment↔sale bridge
    was populated (see ADR-023) have no shipment, hence no season. `include_null_link`
    keeps those visible whenever the resolved season is open, and hides them the
    moment a closed season is explicitly browsed — browsing a closed season is
    browsing that season's archive, and an unlinked row belongs to no season, so
    it has no place there. Detail routes bypass scoping — Rule A.
    """

    permission_classes = [IsAuthenticated, DynamicResourcePermission, SeasonNotClosed]
    resource_code = 'sale'
    season_field = 'shipment__season'
    include_null_link = True

    queryset = ContractSale.objects.select_related(
        'contract',
        'shipment',
        'shipment__packing_template',  # whole-truck packing (CMR)
        'export_firm',
        'import_firm',
    ).order_by('-invoice_date', 'contract_id', 'invoice_number')

    def perform_create(self, serializer):
        """Create a sale, refusing a closed-season target.

        `ContractSale.freeze_season` resolves through `contract` when
        `shipment` is NULL, so an unlinked sale under a closed season's
        contract is refused too.
        """
        # Write freeze (D1): CreateModelMixin never calls get_object(), so
        # the SeasonNotClosed object permission cannot fire on a create.
        self.assert_create_target_open(serializer)
        serializer.save()

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

        if self.action == 'list':
            qs = self.apply_season_scope(qs)

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
            place_loading: generate-time loading point (invoice + CMR).
            tir_carnet:    generate-time TIR carnet № (CMR, Uzbekistan transit).

        Returns the file as an attachment. PDF requires LibreOffice on the server;
        when absent it returns 503 with a clear message (the .docx path is fine).
        """
        invoice = self.get_object()
        doc_type = request.query_params.get('type', 'invoice_ru')
        fmt = request.query_params.get('fmt', 'docx')
        overrides = {
            key: value
            for key in ('place_loading', 'tir_carnet')
            if (value := request.query_params.get(key, '').strip())
        }

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

        # Packing guard applies to ALL document types (invoice + CT-1/FITO/customs
        # letters), by product decision: no paper leaves for a truck whose
        # gross/net/boxes/pallets aren't settled — even the letters, which don't
        # print packing, should not be produced ahead of it.
        missing = missing_packing_fields(invoice)
        if missing:
            return Response(
                {'error': PACKING_REQUIRED_MESSAGE, 'missing_packing': missing},
                status=400,
            )

        try:
            data, filename, content_type = generate(doc_type, invoice, fmt, overrides)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        except DocumentRenderError as exc:
            return Response({'error': str(exc)}, status=503)

        response = HttpResponse(data, content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


class ShipmentCmrView(APIView):
    """Truck-level CMR — one per shipment, all export firms listed as senders.

    ``GET /api/v1/contracts/shipments/{pk}/cmr/?lang=ru|en&fmt=docx|pdf``, plus
    the same generate-time ``place_loading`` / ``tir_carnet`` params as the
    per-firm documents. Gated by the 'sale' resource; the packing guard applies
    (whole-truck gross/net/boxes/pallets must be filled in the Sheet).
    """

    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    resource_code = 'sale'

    def get(self, request, pk=None):
        from apps.export.models import Shipment

        shipment = (
            Shipment.objects.filter(pk=pk)
            .select_related('import_firm', 'packing_template')
            .prefetch_related('firm_splits__export_firm', 'sales')
            .first()
        )
        if shipment is None:
            return Response({'error': 'Shipment not found.'}, status=404)

        # The Word form is the CMR the office actually uses, so it backs BOTH the
        # .docx download and the PDF (converting the xlsx instead would emit the
        # older overlay layout). `fmt=xlsx` still serves the spreadsheet overlay —
        # it is no longer offered in the UI but is kept wired for future use.
        # NOTE: for the xlsx-engine spec, generate()'s 'docx' means "the engine's
        # native format" — i.e. the .xlsx itself.
        lang = 'en' if request.query_params.get('lang') == 'en' else 'ru'
        requested = request.query_params.get('fmt', 'docx')
        if requested == 'xlsx':
            doc_type, fmt = f'cmr_{lang}', 'docx'
        elif requested == 'pdf':
            doc_type, fmt = f'cmr_{lang}_docx', 'pdf'
        else:
            doc_type, fmt = f'cmr_{lang}_docx', 'docx'
        overrides = {
            key: value
            for key in ('place_loading', 'tir_carnet')
            if (value := request.query_params.get(key, '').strip())
        }

        missing = missing_packing_on(shipment)
        if missing:
            return Response(
                {'error': PACKING_REQUIRED_MESSAGE, 'missing_packing': missing}, status=400,
            )

        try:
            data, filename, content_type = generate(doc_type, shipment, fmt, overrides)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        except DocumentRenderError as exc:
            return Response({'error': str(exc)}, status=503)

        response = HttpResponse(data, content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


class ShipmentPacketZipView(APIView):
    """Whole document packet for a truck as one zip.

    ``GET /api/v1/contracts/shipments/{pk}/packet.zip?lang=ru|en&fmt=docx|pdf``
    (plus ``place_loading`` / ``tir_carnet``). Bundles the truck CMR + every
    firm's invoice + CT-1/FITO/customs letters. Gated by 'sale'; packing guard
    applies. PDF needs LibreOffice — else 503 (whole packet fails as one).
    """

    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    resource_code = 'sale'

    def get(self, request, pk=None):
        from apps.export.models import Shipment

        shipment = (
            Shipment.objects.filter(pk=pk)
            .select_related('import_firm', 'packing_template')
            .prefetch_related(
                'firm_splits__export_firm',
                'sales__contract', 'sales__export_firm', 'sales__import_firm',
                'sales__line_items',
            )
            .first()
        )
        if shipment is None:
            return Response({'error': 'Shipment not found.'}, status=404)

        missing = missing_packing_on(shipment)
        if missing:
            return Response(
                {'error': PACKING_REQUIRED_MESSAGE, 'missing_packing': missing}, status=400,
            )

        lang = 'en' if request.query_params.get('lang') == 'en' else 'ru'
        fmt = 'pdf' if request.query_params.get('fmt') == 'pdf' else 'docx'
        overrides = {
            key: value
            for key in ('place_loading', 'tir_carnet')
            if (value := request.query_params.get(key, '').strip())
        }

        # Skip voided sales — no invoice/letters for a cancelled firm share.
        active_sales = [s for s in shipment.sales.all() if s.status != ContractSale.STATUS_VOID]
        try:
            data = generate_packet_zip(shipment, active_sales, lang, fmt, overrides)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        except DocumentRenderError as exc:
            return Response({'error': str(exc)}, status=503)

        code = (shipment.shipment_code or 'NA').replace('/', '-')
        response = HttpResponse(data, content_type=ZIP_CONTENT_TYPE)
        response['Content-Disposition'] = f'attachment; filename="Packet_{code}_{lang.upper()}.zip"'
        return response


class DocumentPacketListView(ListAPIView):
    """Document packets — one row per truck for the Documents page.

    ``GET /api/v1/contracts/document-packets/`` returns non-archived, non-deleted
    trucks that have **at least one export firm** assigned (a firm split) —
    regardless of lifecycle status, so a truck in progress shows up rather than
    silently vanishing. Trucks still missing buyer / country / driver / plate /
    packing appear with ``is_ready=false`` + ``missing_setup[]`` so the team sees
    *what to fill* instead of wondering why it isn't listed. Per truck: its firms
    + per-firm ``sale_id`` and the packing-complete flag. Always scoped to the
    resolved season (``?season=``, default active); filters: ``?date=`` (exact),
    ``?date_from=`` / ``?date_to=`` (range), ``?status=`` (status code),
    ``?firm=`` (export firm id). Gated by 'sale'.
    """

    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    resource_code = 'sale'
    serializer_class = DocumentPacketSerializer

    def get_queryset(self):
        from apps.export.models import Shipment

        # Floor to appear: a real export truck (≥1 firm split). Buyer / country /
        # driver / plate / packing are NOT filters — they surface as readiness
        # flags on the row, so an in-progress truck is visible with guidance.
        qs = (
            Shipment.objects.filter(
                deleted_at__isnull=True,
                is_archived=False,
                firm_splits__isnull=False,
            )
            .select_related('import_firm', 'country', 'city', 'status', 'packing_template')
            .prefetch_related('firm_splits__export_firm', 'sales')
            .distinct()
            .order_by('-date', '-id')
        )
        # Season scope is unconditional, not a fallback for "no date filter":
        # otherwise picking a closed season in the switcher *and* a date range
        # would silently return active-season rows.
        season = resolve_season(self.request)
        if season is None:
            return qs.none()  # fail closed (D7, spec §3.1)
        qs = qs.filter(season=season)
        params = self.request.query_params
        if params.get('date'):
            qs = qs.filter(date=params['date'])
        else:
            if params.get('date_from'):
                qs = qs.filter(date__gte=params['date_from'])
            if params.get('date_to'):
                qs = qs.filter(date__lte=params['date_to'])
        if params.get('status'):
            qs = qs.filter(status__code=params['status'])
        if params.get('firm'):
            qs = qs.filter(firm_splits__export_firm_id=params['firm'])
        return qs


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
        shipment = Shipment.objects.filter(pk=data.get('shipment')).select_related(
            'season',
        ).first()
        if shipment is None:
            return Response({'error': 'Shipment not found.'}, status=404)

        # Write freeze (D1). An APIView taking the shipment from the request
        # body — there is no get_object(), so layer 1 never sees it.
        assert_season_open(shipment.season)

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


_FIRM_PACKING_FIELDS = ('gross_kg', 'box_count', 'pallet_count', 'pallet_weight_kg')
_SHARE_FIELDS = ('net_kg', *_FIRM_PACKING_FIELDS)


def _set_firm_weights(shipment, weight_by_firm, user):
    """Replace firm-split weights (quota-safe) — mirrors ShipmentViewSet.set_firm_splits.

    Deletes and recreates ShipmentFirmSplit with the given weights, then re-syncs
    draft quota usage. Raises ApprovedQuotaExistsError (→ 400) if approved usage exists.
    """
    from django.db import transaction
    from apps.export.models import ShipmentFirmSplit
    from apps.export.services.quota_sync import sync_draft_quota_usage_for_shipment

    with transaction.atomic():
        existing = list(shipment.firm_splits.values_list('export_firm_id', 'split_order'))
        order_by_firm = {fid: order for fid, order in existing}
        shipment.firm_splits.all().delete()
        rows = [
            ShipmentFirmSplit(
                shipment=shipment, export_firm_id=fid, weight_kg=weight,
                split_order=order_by_firm.get(fid, i + 1),
            )
            for i, (fid, weight) in enumerate(weight_by_firm.items())
        ]
        ShipmentFirmSplit.objects.bulk_create(rows, batch_size=500)
        sync_draft_quota_usage_for_shipment(shipment, user)


class ShipmentPackingView(APIView):
    """Unified per-truck packing (one Excel "gross net" row).

    Pick ONE PackingTemplate on the truck: its whole-truck line feeds the CMR, and
    each firm share is copied onto that firm's ContractSale (editable per truck) and
    sets the firm's weight (= share net, quota-safe). Nothing is derived — every
    number is explicit. NET per firm = its weight; the packing fields print on the
    firm's Invoice.

    GET  ?shipment=<id> → { whole_truck (template values), total_firm_weight,
         consistent, rows[] (per-firm weight + actual packing) }.
    POST { shipment, scope:'template', packing_template } → apply: set template,
         copy shares onto firms (by split order), set firm weights.
    POST { shipment, scope:'firm', export_firm, gross_kg?, box_count?, pallet_count?,
         pallet_weight_kg? } → edit one firm's packing values.
    POST { shipment, scope:'swap', export_firm_a, export_firm_b } → exchange two
         firms' weight + packing.

    Lives in contracts (may read/write export). Reads open; writes gated to
    document-preparing roles.
    """

    permission_classes = [
        IsAuthenticated,
        write_permission('admin', 'director', 'export_manager', 'document_team'),
    ]

    def get(self, request):
        from apps.export.models import Shipment

        shipment_id = request.query_params.get('shipment')
        if not shipment_id:
            return Response({'error': 'shipment query param is required.'}, status=400)
        shipment = (
            Shipment.objects.filter(pk=shipment_id)
            .select_related('packing_template')
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
        truck = shipment.packing_template

        rows = []
        for split in splits:
            sale = sale_by_firm.get(split.export_firm_id)
            rows.append({
                'export_firm': split.export_firm_id,
                'export_firm_code': split.export_firm.code,
                'export_firm_name': split.export_firm.name_short or split.export_firm.name_tk,
                'weight_kg': split.weight_kg,
                'sale_id': sale.id if sale else None,
                **{f: (getattr(sale, f) if sale else None) for f in _FIRM_PACKING_FIELDS},
            })

        truck_net = truck.net_kg if truck else None
        consistent = (
            truck_net is not None and total_weight > 0 and Decimal(truck_net) == total_weight
        )
        return Response({
            'shipment': shipment.id,
            'whole_truck': {
                'packing_template': truck.id if truck else None,
                'packing_template_name': truck.name if truck else None,
                **{f: (getattr(truck, f) if truck else None)
                   for f in ('net_kg', *_FIRM_PACKING_FIELDS)},
            },
            'total_firm_weight': total_weight,
            'consistent': consistent,
            'rows': rows,
        })

    def post(self, request):
        from django.db import transaction
        from apps.export.models import PackingTemplate, Shipment
        from apps.export.services.quota_sync import ApprovedQuotaExistsError
        from apps.contracts.models import ContractSale

        data = request.data
        shipment = (
            Shipment.objects.filter(pk=data.get('shipment'))
            .select_related('season')
            .prefetch_related('firm_splits', 'sales').first()
        )
        if shipment is None:
            return Response({'error': 'Shipment not found.'}, status=404)

        # Write freeze (D1) — see ShipmentFirmContractsView.post.
        assert_season_open(shipment.season)

        scope = data.get('scope')

        if scope == 'template':
            template = (
                PackingTemplate.objects.filter(pk=data.get('packing_template'))
                .prefetch_related('shares').first()
            )
            if template is None:
                return Response({'error': 'Unknown packing_template.'}, status=400)
            firms = list(shipment.firm_splits.order_by('split_order')
                         .values_list('export_firm_id', flat=True))
            shares = list(template.shares.all())
            if len(shares) != len(firms):
                return Response(
                    {'error': f'Template has {len(shares)} shares but the truck has '
                              f'{len(firms)} firms. Pick a template that matches, or fix the firms.'},
                    status=400,
                )
            try:
                with transaction.atomic():
                    _set_firm_weights(
                        shipment, {fid: shares[i].net_kg for i, fid in enumerate(firms)}, request.user,
                    )
                    # Copy each share's packing onto the firm's sale. A firm with no
                    # linked ContractSale matches 0 rows — report it so the operator
                    # knows to link a contract (weight/quota are still set above).
                    no_sale_firms = []
                    for i, fid in enumerate(firms):
                        updated = ContractSale.objects.filter(
                            shipment=shipment, export_firm_id=fid,
                        ).update(**{f: getattr(shares[i], f) for f in _FIRM_PACKING_FIELDS})
                        if updated == 0:
                            no_sale_firms.append(fid)
                    Shipment.objects.filter(pk=shipment.id).update(packing_template_id=template.id)
            except ApprovedQuotaExistsError as exc:
                return Response({'error': str(exc)}, status=400)
            return Response({'scope': 'template', 'packing_template': template.id,
                             'no_sale_firms': no_sale_firms})

        if scope == 'firm':
            sale = ContractSale.objects.filter(
                shipment=shipment, export_firm_id=data.get('export_firm'),
            ).first()
            if sale is None:
                return Response(
                    {'error': 'No sale linked for this firm — link a contract first.'}, status=400,
                )
            updates = {f: data[f] for f in _FIRM_PACKING_FIELDS if f in data}
            if updates:
                ContractSale.objects.filter(pk=sale.id).update(**updates)
            return Response({'scope': 'firm', 'export_firm': sale.export_firm_id,
                             'sale_id': sale.id, **updates})

        if scope == 'swap':
            fa, fb = data.get('export_firm_a'), data.get('export_firm_b')
            splits = {s.export_firm_id: s for s in shipment.firm_splits.all()}
            if fa not in splits or fb not in splits:
                return Response({'error': 'Both firms must be on the truck.'}, status=400)
            # Keep every firm's weight; exchange only the two — otherwise the other
            # firms on a 3+ firm truck would be deleted by _set_firm_weights.
            new_weights = {fid: s.weight_kg for fid, s in splits.items()}
            new_weights[fa], new_weights[fb] = splits[fb].weight_kg, splits[fa].weight_kg
            try:
                with transaction.atomic():
                    _set_firm_weights(shipment, new_weights, request.user)
                    sales = {s.export_firm_id: s for s in ContractSale.objects.filter(
                        shipment=shipment, export_firm_id__in=[fa, fb])}
                    packing_swapped = fa in sales and fb in sales
                    if packing_swapped:
                        pa = {f: getattr(sales[fa], f) for f in _FIRM_PACKING_FIELDS}
                        pb = {f: getattr(sales[fb], f) for f in _FIRM_PACKING_FIELDS}
                        ContractSale.objects.filter(pk=sales[fa].id).update(**pb)
                        ContractSale.objects.filter(pk=sales[fb].id).update(**pa)
            except ApprovedQuotaExistsError as exc:
                return Response({'error': str(exc)}, status=400)
            return Response({'scope': 'swap', 'export_firm_a': fa, 'export_firm_b': fb,
                             'packing_swapped': packing_swapped})

        return Response({'error': "scope must be 'template', 'firm', or 'swap'."}, status=400)
