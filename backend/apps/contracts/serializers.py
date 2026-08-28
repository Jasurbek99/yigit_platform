"""Serializers for the contracts app.

Three serializers per the API contract rules:
  - ContractListSerializer   — flat, for ProTable list
  - ContractDetailSerializer — same plus editable_fields
  - ContractCreateSerializer — writable, sets created_by from request

  - ContractSaleListSerializer   — flat, for the Sales tab table
  - ContractSaleDetailSerializer — same plus editable_fields
  - ContractSaleCreateSerializer — writable, validates money and contract status
"""
from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from apps.core.permissions import get_editable_fields
from apps.core.seasons import get_active_season
from apps.contracts.models import (
    Contract,
    ContractAttachment,
    ContractSale,
    ContractSaleLineItem,
    DocumentLayoutSetting,
)
from apps.contracts.services.contract_number import (
    next_contract_no,
    parse_contract_number,
)
from apps.contracts.services.document_context import (
    country_template_supported,
    missing_packing_on,
)


class ContractAttachmentSerializer(serializers.ModelSerializer):
    """Read-only metadata for a contract document attachment.

    No file URL is exposed — contract documents are served only through the
    authenticated ``attachments/<id>/download`` action, never a direct /media/ URL.
    """

    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ContractAttachment
        fields = [
            'id',
            'original_filename',
            'mime_type',
            'size_bytes',
            'uploaded_by',
            'uploaded_by_name',
            'uploaded_at',
        ]
        read_only_fields = fields

    def get_uploaded_by_name(self, obj: ContractAttachment) -> str:
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.username


class ContractListSerializer(serializers.ModelSerializer):
    """Flat serializer for the shipment list / ProTable.

    All FK fields return both the ID (for mutations) and a display name sibling.
    """

    # === Export firm ===
    export_firm = serializers.IntegerField(source='export_firm_id', read_only=True)
    export_firm_name = serializers.CharField(
        source='export_firm.name_tk', read_only=True,
    )
    export_firm_code = serializers.CharField(
        source='export_firm.code', read_only=True,
    )

    # === Import firm ===
    import_firm = serializers.IntegerField(source='import_firm_id', read_only=True)
    import_firm_name = serializers.SerializerMethodField()

    # === Season ===
    season = serializers.IntegerField(source='season_id', read_only=True)
    season_name = serializers.CharField(
        source='season.name', read_only=True, default=None,
    )

    # === Status ===
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    # Annotated by ContractViewSet.get_queryset(). True when at least one
    # ContractSale points at this contract — the list hides its Delete action
    # for such rows, and destroy() refuses them.
    has_sales = serializers.BooleanField(read_only=True)

    # === Computed properties (from model @property methods) ===
    trucks_remaining = serializers.IntegerField(read_only=True)
    quantity_remaining_kg = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )
    amount_remaining_usd = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )
    ostatok_usd = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = Contract
        fields = [
            'id',
            'contract_number',
            'status',
            'status_display',
            'has_sales',
            'export_firm',
            'export_firm_name',
            'export_firm_code',
            'import_firm',
            'import_firm_name',
            'season',
            'season_name',
            'contract_type',
            'passport_sdelka',
            'incoterm',
            'planned_trucks',
            'planned_quantity_kg',
            'planned_amount_usd',
            'exported_trucks',
            'exported_quantity_kg',
            'exported_amount_usd',
            'trucks_remaining',
            'quantity_remaining_kg',
            'amount_remaining_usd',
            'payment_received_usd',
            'ostatok_usd',
            'last_invoice_number',
            'start_date',
            'end_date',
            'created_at',
        ]

    def get_import_firm_name(self, obj: Contract) -> str | None:
        """Return name_short if available, else name_company."""
        firm = obj.import_firm
        if firm is None:
            return None
        return firm.name_short or firm.name_company


class ContractDetailSerializer(ContractListSerializer):
    """Full contract detail — same as list for Slice A.

    Later slices will add nested sales, payments, and passports.
    """

    editable_fields = serializers.SerializerMethodField()
    attachments = ContractAttachmentSerializer(many=True, read_only=True)
    # Buyer's destination country code (display / filtering).
    import_firm_country_code = serializers.CharField(
        source='import_firm.country.code', read_only=True, default=None,
    )
    # Whether the contract .docx can be generated for this buyer's country — the
    # template's §4 clauses name that country's authorities in the genitive case,
    # which only a fixed set of countries has a verified form for. Server-owned so
    # the frontend never carries a second copy of the list.
    contract_template_supported = serializers.SerializerMethodField()
    # The buyer firm's director name ("Director's Full Name" = ImportFirm.contact_person).
    # The generator modal pre-fills its director field from this (editable).
    import_firm_director = serializers.CharField(
        source='import_firm.contact_person', read_only=True, default=None,
    )

    class Meta(ContractListSerializer.Meta):
        fields = ContractListSerializer.Meta.fields + [
            'editable_fields', 'attachments', 'import_firm_country_code',
            'import_firm_director', 'contract_template_supported',
        ]

    def get_contract_template_supported(self, obj: Contract) -> bool:
        """True when the buyer's country has a template-supported genitive form."""
        country = getattr(obj.import_firm, 'country', None)
        return country_template_supported(getattr(country, 'code', None))

    def get_editable_fields(self, obj: Contract) -> list[str]:
        """Return the fields editable by the requesting user's role."""
        request = self.context.get('request')
        if request is None:
            return []
        role = getattr(request.user, 'role', None)
        return get_editable_fields(role, resource_code='contract')


class ContractCreateSerializer(serializers.ModelSerializer):
    """Writable serializer for contract creation (POST).

    Sets ``created_by`` from the request user automatically.
    On create, status defaults to 'active' and remaining_usd = 0.

    ``contract_number`` is optional: when blank it is auto-generated per-seller,
    per-year (``next_contract_no``); when supplied it is kept verbatim and its
    seq/year are parsed out (best-effort) to keep the counter consistent.
    """

    class Meta:
        model = Contract
        fields = [
            'contract_number',
            'export_firm',
            'import_firm',
            'season',
            'customer',
            'contract_type',
            'passport_sdelka',
            'incoterm',
            'start_date',
            'end_date',
            'planned_trucks',
            'planned_quantity_kg',
            'planned_amount_usd',
        ]
        # Optional (auto-generated when blank/omitted, see create()), but keep the
        # model's UniqueValidator so a duplicate supplied number still returns 400.
        extra_kwargs = {
            'contract_number': {'required': False, 'allow_blank': True},
            # Defaults server-side to the active season — a contract is always
            # for the current season, so the create form doesn't ask for it.
            'season': {'required': False},
        }

    def create(self, validated_data: dict) -> Contract:
        """Create a contract, auto-numbering it and setting created_by.

        Wrapped in a transaction so the per-seller seq allocation and the insert
        are atomic; the filtered unique constraint on
        (export_firm, contract_year, seq) is the race backstop.
        """
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            validated_data['created_by'] = request.user

        # A contract is always for the current season — default it server-side
        # so the create form need not ask.
        if not validated_data.get('season'):
            validated_data['season'] = get_active_season()

        export_firm = validated_data['export_firm']
        contract_date = validated_data.get('start_date') or date.today()
        supplied = (validated_data.get('contract_number') or '').strip()

        with transaction.atomic():
            if supplied:
                # Manual / import number — keep verbatim, parse seq+year if standard.
                validated_data['contract_number'] = supplied
                parsed = parse_contract_number(supplied)
                if parsed:
                    validated_data['seq'], validated_data['contract_year'] = parsed
            else:
                seq, year, number = next_contract_no(export_firm, contract_date)
                validated_data['contract_number'] = number
                validated_data['seq'] = seq
                validated_data['contract_year'] = year
            # status defaults to 'active'; remaining_usd computed in model.save()
            return super().create(validated_data)


# ─── Contract sale serializers ────────────────────────────────────────────────


class ContractSaleLineItemSerializer(serializers.ModelSerializer):
    """One invoice line (name × qty × price). ``line_number`` / ``total_usd`` are
    server-assigned; the client sends an ordered list, each row's price/quantity."""

    class Meta:
        model = ContractSaleLineItem
        fields = [
            'id', 'line_number', 'product_name', 'hs_code',
            'quantity_kg', 'gross_kg', 'box_count', 'price_per_kg', 'total_usd',
        ]
        read_only_fields = ['id', 'line_number', 'total_usd']
        extra_kwargs = {
            'product_name': {'required': False},
            'hs_code': {'required': False},
            'gross_kg': {'required': False, 'allow_null': True},
            'box_count': {'required': False, 'allow_null': True},
        }


class ContractSaleListSerializer(serializers.ModelSerializer):
    """Flat serializer for the Sales tab table.

    All FK fields follow the api-contract.md renaming convention:
    ID alongside a _name / _code display sibling.
    """

    # === Contract ===
    contract = serializers.IntegerField(source='contract_id', read_only=True)
    contract_number = serializers.CharField(
        source='contract.contract_number', read_only=True,
    )

    # === Shipment ===
    shipment = serializers.IntegerField(source='shipment_id', read_only=True)
    shipment_code = serializers.SerializerMethodField()

    # === Export firm ===
    export_firm = serializers.IntegerField(source='export_firm_id', read_only=True)
    export_firm_name = serializers.CharField(
        source='export_firm.name_tk', read_only=True, default=None,
    )

    # === Import firm ===
    import_firm = serializers.IntegerField(source='import_firm_id', read_only=True)
    import_firm_name = serializers.SerializerMethodField()

    # === Status display ===
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = ContractSale
        fields = [
            'id',
            'contract',
            'contract_number',
            'shipment',
            'shipment_code',
            'invoice_number',
            'invoice_date',
            'serial_truck_number',
            'export_firm',
            'export_firm_name',
            'import_firm',
            'import_firm_name',
            'incoterm',
            'quantity_kg',
            'price_per_kg',
            'total_usd',
            # Per-firm packing override (null = derived from the truck config)
            'gross_kg',
            'box_count',
            'pallet_count',
            'pallet_weight_kg',
            'passport_sdelka',
            'scan_uploaded',
            'status',
            'status_display',
            'created_at',
            'updated_at',
        ]

    def get_shipment_code(self, obj: ContractSale) -> str | None:
        """Return the shipment_code of the linked shipment, or None."""
        if obj.shipment_id is None:
            return None
        # The model attribute is `shipment_code` (it maps to db_column 'code');
        # `getattr(shipment, 'code')` would always miss and return None.
        return obj.shipment.shipment_code

    def get_import_firm_name(self, obj: ContractSale) -> str | None:
        """Return name_short if available, else name_company."""
        firm = obj.import_firm
        if firm is None:
            return None
        return getattr(firm, 'name_short', None) or getattr(firm, 'name_company', None)


class ContractSaleDetailSerializer(ContractSaleListSerializer):
    """Full contract-sale detail — adds editable_fields + invoice line items."""

    editable_fields = serializers.SerializerMethodField()
    line_items = ContractSaleLineItemSerializer(many=True, read_only=True)

    class Meta(ContractSaleListSerializer.Meta):
        fields = ContractSaleListSerializer.Meta.fields + ['editable_fields', 'line_items']

    def get_editable_fields(self, obj: ContractSale) -> list[str]:
        """Return the fields editable by the requesting user's role."""
        request = self.context.get('request')
        if request is None:
            return []
        role = getattr(request.user, 'role', None)
        return get_editable_fields(role, resource_code='sale')


class ContractSaleCreateSerializer(serializers.ModelSerializer):
    """Writable serializer for contract-sale creation and updates.

    Validation rules:
    - Either (quantity_kg AND price_per_kg) OR total_usd must be provided.
      Posting with no money info at all is rejected with 400.
    - The parent contract must not be 'cancelled'. Posting against a cancelled
      contract is rejected with 400.
    - Duplicate (contract, invoice_number) is rejected by the DB unique constraint,
      surfaced as a 400 by DRF's UniqueTogetherValidator.
    - When ``line_items`` are supplied, they must break down the sale exactly:
      sum(quantity_kg) == quantity_kg and sum(qty × price) == total_usd. Sending
      ``line_items: []`` clears them; omitting the field leaves them untouched.
    """

    line_items = ContractSaleLineItemSerializer(many=True, required=False)

    class Meta:
        model = ContractSale
        fields = [
            'id',
            'contract',
            'shipment',
            'invoice_number',
            'invoice_date',
            'serial_truck_number',
            'export_firm',
            'import_firm',
            'incoterm',
            'quantity_kg',
            'price_per_kg',
            'total_usd',
            'passport_sdelka',
            'scan_uploaded',
            'status',
            'line_items',
        ]
        extra_kwargs = {
            'shipment': {'required': False, 'allow_null': True},
            'serial_truck_number': {'required': False, 'allow_null': True},
            'export_firm': {'required': False, 'allow_null': True},
            'import_firm': {'required': False, 'allow_null': True},
            'incoterm': {'required': False},
            'quantity_kg': {'required': False, 'allow_null': True},
            'price_per_kg': {'required': False, 'allow_null': True},
            'total_usd': {'required': False, 'allow_null': True},
            'passport_sdelka': {'required': False},
            'scan_uploaded': {'required': False},
            'status': {'required': False},
        }

    def _merged(self, attrs: dict, field: str):
        """Return attrs[field] if present; fall back to the existing instance value on PATCH."""
        if field in attrs:
            return attrs[field]
        if self.instance is not None:
            return getattr(self.instance, field, None)
        return None

    def validate(self, attrs: dict) -> dict:
        """Cross-field validation: money info and contract status.

        On PATCH, fields omitted from the request body are read from the
        existing instance so that status-only or single-field PATCHes
        don't trigger a spurious 400.
        """
        # Validate money: at minimum one of the three combinations must be present
        # (merging with instance so PATCH {"status": "paid"} doesn't 400)
        quantity_kg = self._merged(attrs, 'quantity_kg')
        price_per_kg = self._merged(attrs, 'price_per_kg')
        total_usd = self._merged(attrs, 'total_usd')

        has_components = quantity_kg is not None and price_per_kg is not None
        has_total = total_usd is not None

        if not has_components and not has_total:
            raise serializers.ValidationError(
                'Provide either quantity_kg + price_per_kg, or total_usd.'
            )

        # Validate contract is not cancelled — only when the caller is explicitly
        # assigning (or re-assigning) a contract.  On PATCH, if 'contract' is
        # absent from the request body we do NOT fall back to self.instance;
        # that would block status-only PATCHes on sales whose contract was
        # later cancelled, which contradicts the spec intent ("Posting against
        # a cancelled contract is rejected").
        contract = attrs.get('contract')
        if contract is not None and contract.status == Contract.STATUS_CANCELLED:
            raise serializers.ValidationError(
                'Cannot create a sale against a cancelled contract.'
            )

        # Line items must break down the sale exactly (weights + money reconcile),
        # so quotas / contract rollups — which read the sale's own totals — stay
        # correct. Compared with a 0.01 tolerance for rounding. (When the sale has
        # only total_usd and no quantity_kg — a bare bridge sale — only the money
        # side is checked.)
        line_items = attrs.get('line_items')
        # A money-changing PATCH that omits line_items must still reconcile against
        # the sale's EXISTING rows, else changing quantity/price/total would leave a
        # now-mismatched set of lines untouched and silent.
        if line_items is None and self.instance is not None and any(
            field in attrs for field in ('quantity_kg', 'price_per_kg', 'total_usd')
        ):
            line_items = [
                {'quantity_kg': li.quantity_kg, 'price_per_kg': li.price_per_kg}
                for li in self.instance.line_items.all()
            ]
        if line_items:
            sale_qty = quantity_kg
            sale_total = total_usd
            if sale_total is None and quantity_kg is not None and price_per_kg is not None:
                sale_total = quantity_kg * price_per_kg
            sum_qty = sum((li['quantity_kg'] for li in line_items), Decimal('0'))
            sum_total = sum(
                (li['quantity_kg'] * li['price_per_kg'] for li in line_items), Decimal('0'),
            )
            if sale_qty is not None and abs(sum_qty - sale_qty) > Decimal('0.01'):
                raise serializers.ValidationError(
                    f'Line item quantities ({sum_qty} kg) must sum to the sale '
                    f'quantity ({sale_qty} kg).'
                )
            if sale_total is not None and abs(sum_total - sale_total) > Decimal('0.01'):
                raise serializers.ValidationError(
                    f'Line item amounts (${sum_total}) must sum to the sale '
                    f'total (${sale_total}).'
                )

        return attrs

    def _replace_line_items(self, sale: ContractSale, line_items: list[dict]) -> None:
        """Replace all of a sale's line items — line_number reassigned by order,
        total_usd computed. ``[]`` clears them."""
        sale.line_items.all().delete()
        rows = [
            ContractSaleLineItem(
                sale=sale,
                line_number=index,
                product_name=li.get('product_name', '') or '',
                hs_code=li.get('hs_code', '') or '',
                quantity_kg=li['quantity_kg'],
                gross_kg=li.get('gross_kg'),
                box_count=li.get('box_count'),
                price_per_kg=li['price_per_kg'],
                total_usd=li['quantity_kg'] * li['price_per_kg'],
            )
            for index, li in enumerate(line_items, start=1)
        ]
        if rows:
            ContractSaleLineItem.objects.bulk_create(rows, batch_size=500)

    @transaction.atomic
    def create(self, validated_data: dict) -> ContractSale:
        line_items = validated_data.pop('line_items', None)
        sale = super().create(validated_data)
        if line_items is not None:
            self._replace_line_items(sale, line_items)
        return sale

    @transaction.atomic
    def update(self, instance: ContractSale, validated_data: dict) -> ContractSale:
        line_items = validated_data.pop('line_items', None)
        sale = super().update(instance, validated_data)
        if line_items is not None:  # present (incl. []) → replace; omitted → leave
            self._replace_line_items(sale, line_items)
        return sale


class DocumentPacketSerializer(serializers.Serializer):
    """One truck's document packet for the Documents page (read-only).

    A truck (``Shipment``) carries 1–3 export firms; each firm has its own
    per-firm documents (invoice / letters, keyed by its ``sale_id``), while the
    CMR is one truck-level document. ``packing_complete`` / ``missing_packing``
    reflect the same guard the generation endpoints enforce, so the page can
    flag trucks whose packing must still be filled before any document generates.

    Renders from a ``Shipment`` queryset with ``import_firm`` / ``country`` /
    ``city`` / ``status`` / ``packing_template`` select_related and
    ``firm_splits__export_firm`` / ``sales`` prefetched.
    """

    id = serializers.IntegerField(read_only=True)
    shipment_code = serializers.CharField(read_only=True)
    date = serializers.DateField(read_only=True)
    status_code = serializers.CharField(source='status.code', read_only=True)
    status_display = serializers.CharField(source='status.name_en', read_only=True)
    country_name = serializers.CharField(source='country.name_en', read_only=True, default=None)
    city_name = serializers.CharField(source='city.name', read_only=True, default=None)
    buyer_name = serializers.SerializerMethodField()
    packing_complete = serializers.SerializerMethodField()
    missing_packing = serializers.SerializerMethodField()
    missing_setup = serializers.SerializerMethodField()
    is_ready = serializers.SerializerMethodField()
    firms = serializers.SerializerMethodField()

    def get_buyer_name(self, obj) -> str | None:
        firm = obj.import_firm
        if firm is None:
            return None
        return firm.name_short or firm.name_company

    def get_missing_packing(self, obj) -> list[str]:
        return missing_packing_on(obj)

    def get_packing_complete(self, obj) -> bool:
        return not missing_packing_on(obj)

    def get_missing_setup(self, obj) -> list[str]:
        """Non-packing paperwork fields still empty on the truck — the ones the
        team fills on the Sheet before documents can be generated."""
        missing = []
        if obj.import_firm_id is None:
            missing.append('import_firm')
        if obj.country_id is None:
            missing.append('country')
        if not (obj.driver_name or '').strip():
            missing.append('driver_name')
        if not (obj.truck_plate or '').strip():
            missing.append('truck_plate')
        return missing

    def get_is_ready(self, obj) -> bool:
        """True when nothing blocks document generation — setup + packing both done."""
        return not self.get_missing_setup(obj) and not missing_packing_on(obj)

    def get_firms(self, obj) -> list[dict]:
        # Voided sales don't count — the firm then shows "link contract" again.
        sales_by_firm = {
            sale.export_firm_id: sale
            for sale in obj.sales.all()
            if sale.status != ContractSale.STATUS_VOID
        }
        firms = []
        for split in obj.firm_splits.all():
            firm = split.export_firm
            sale = sales_by_firm.get(firm.id)
            firms.append({
                'export_firm_id': firm.id,
                'export_firm_name': firm.name_short or firm.code,
                'sale_id': sale.id if sale else None,
                'invoice_number': sale.invoice_number if sale else None,
            })
        return firms


class DocumentLayoutSettingSerializer(serializers.ModelSerializer):
    """Read/write the page-layout adjustments for one document type.

    Every value is an adjustment against the template, not an absolute: a margin
    is a ±mm delta and the font is a percentage. See the model docstring for why
    absolutes do not work on these templates.
    """

    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentLayoutSetting
        fields = [
            'document_key',
            'font_scale_pct',
            'line_spacing',
            'margin_top_delta_mm',
            'margin_bottom_delta_mm',
            'margin_left_delta_mm',
            'margin_right_delta_mm',
            'version',
            'updated_at',
            'updated_by_name',
        ]
        read_only_fields = ['document_key', 'version', 'updated_at']

    def get_updated_by_name(self, obj) -> str:
        user = obj.updated_by
        return user.get_full_name() or user.username if user else ''

    def validate(self, attrs: dict) -> dict:
        """Run the model's range checks so the bounds live in exactly one place.

        Validates the merged result (a PATCH may send one field), on a throwaway
        instance so a rejected payload leaves ``self.instance`` untouched.
        """
        base = self.instance or DocumentLayoutSetting()
        candidate = DocumentLayoutSetting(
            document_key=base.document_key,
            font_scale_pct=attrs.get('font_scale_pct', base.font_scale_pct),
            line_spacing=attrs.get('line_spacing', base.line_spacing),
            margin_top_delta_mm=attrs.get(
                'margin_top_delta_mm', base.margin_top_delta_mm),
            margin_bottom_delta_mm=attrs.get(
                'margin_bottom_delta_mm', base.margin_bottom_delta_mm),
            margin_left_delta_mm=attrs.get(
                'margin_left_delta_mm', base.margin_left_delta_mm),
            margin_right_delta_mm=attrs.get(
                'margin_right_delta_mm', base.margin_right_delta_mm),
        )
        try:
            candidate.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc
        return attrs
