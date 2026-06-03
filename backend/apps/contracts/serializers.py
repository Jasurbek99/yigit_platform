"""Serializers for the contracts app.

Three serializers per the API contract rules:
  - ContractListSerializer   — flat, for ProTable list
  - ContractDetailSerializer — same plus editable_fields
  - ContractCreateSerializer — writable, sets created_by from request
"""
from rest_framework import serializers

from apps.core.permissions import get_editable_fields
from apps.contracts.models import Contract


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
