"""Serializers for the contracts app.

Three serializers per the API contract rules:
  - ContractListSerializer   — flat, for ProTable list
  - ContractDetailSerializer — same plus editable_fields
  - ContractCreateSerializer — writable, sets created_by from request

  - InvoiceListSerializer   — flat, for the Faktura tab table
  - InvoiceDetailSerializer — same plus editable_fields
  - InvoiceCreateSerializer — writable, validates money and contract status
"""
from rest_framework import serializers

from apps.core.permissions import get_editable_fields
from apps.contracts.models import Contract, Invoice


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
            'export_firm',
            'export_firm_name',
            'export_firm_code',
            'import_firm',
            'import_firm_name',
            'season',
            'season_name',
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

    Later slices will add nested invoices, payments, and passports.
    """

    editable_fields = serializers.SerializerMethodField()

    class Meta(ContractListSerializer.Meta):
        fields = ContractListSerializer.Meta.fields + ['editable_fields']

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
            'incoterm',
            'start_date',
            'end_date',
            'planned_trucks',
            'planned_quantity_kg',
            'planned_amount_usd',
        ]

    def create(self, validated_data: dict) -> Contract:
        """Create a contract and set created_by from the request context."""
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        # status defaults to 'active' via model default
        # remaining_usd is computed in model.save()
        return super().create(validated_data)


# ─── Invoice serializers ──────────────────────────────────────────────────────


class InvoiceListSerializer(serializers.ModelSerializer):
    """Flat serializer for the Faktura tab table.

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
        model = Invoice
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
            'passport_sdelka',
            'scan_uploaded',
            'status',
            'status_display',
            'created_at',
            'updated_at',
        ]

    def get_shipment_code(self, obj: Invoice) -> str | None:
        """Return the cargo_code of the linked shipment, or None."""
        if obj.shipment_id is None:
            return None
        shipment = obj.shipment
        return getattr(shipment, 'code', None)

    def get_import_firm_name(self, obj: Invoice) -> str | None:
        """Return name_short if available, else name_company."""
        firm = obj.import_firm
        if firm is None:
            return None
        return getattr(firm, 'name_short', None) or getattr(firm, 'name_company', None)


class InvoiceDetailSerializer(InvoiceListSerializer):
    """Full invoice detail — adds editable_fields for the edit form."""

    editable_fields = serializers.SerializerMethodField()

    class Meta(InvoiceListSerializer.Meta):
        fields = InvoiceListSerializer.Meta.fields + ['editable_fields']

    def get_editable_fields(self, obj: Invoice) -> list[str]:
        """Return the fields editable by the requesting user's role."""
        request = self.context.get('request')
        if request is None:
            return []
        role = getattr(request.user, 'role', None)
        return get_editable_fields(role, resource_code='invoice')


class InvoiceCreateSerializer(serializers.ModelSerializer):
    """Writable serializer for invoice creation and updates.

    Validation rules:
    - Either (quantity_kg AND price_per_kg) OR total_usd must be provided.
      Posting with no money info at all is rejected with 400.
    - The parent contract must not be 'cancelled'. Posting against a cancelled
      contract is rejected with 400.
    - Duplicate (contract, invoice_number) is rejected by the DB unique constraint,
      surfaced as a 400 by DRF's UniqueTogetherValidator.
    """

    class Meta:
        model = Invoice
        fields = [
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
        # that would block status-only PATCHes on invoices whose contract was
        # later cancelled, which contradicts the spec intent ("Posting against
        # a cancelled contract is rejected").
        contract = attrs.get('contract')
        if contract is not None and contract.status == Contract.STATUS_CANCELLED:
            raise serializers.ValidationError(
                'Cannot create an invoice against a cancelled contract.'
            )

        return attrs
