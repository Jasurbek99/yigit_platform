"""Lot, its entries, and the reference lists of the market phone app. Money and kg go out as strings."""
from decimal import Decimal

from rest_framework import serializers

from apps.export.models import Shipment
from apps.market.models import Buyer, Lot, LotExpense, Sale, Spoilage
from apps.market.services.lots import ON_THE_ROAD_CODES
from apps.market.services.totals import lot_totals, needs_receipt

MONEY = {'max_digits': 12, 'decimal_places': 2}


def _product(shipment: Shipment) -> dict | None:
    """The shipment's product as `{code, name_ru}`, or None if not set."""
    p = shipment.product_type
    return {'code': p.code, 'name_ru': p.name_ru} if p else None


def shipment_brief(shipment: Shipment) -> dict:
    """`{id, code, export_code, status_code, product}` of a shipment."""
    return {
        'id': shipment.pk,
        'code': shipment.shipment_code,
        'export_code': shipment.export_code,
        'status_code': shipment.status.code if shipment.status_id else None,
        'product': _product(shipment),
    }


def _person(user) -> dict | None:
    """A user as `{id, name}` (first name, else login), or None."""
    return {'id': user.pk, 'name': user.first_name or user.username} if user else None


class LotSerializer(serializers.ModelSerializer):
    """A lot in the list: receipt, state and totals."""

    shipment = serializers.SerializerMethodField()
    seller = serializers.SerializerMethodField()
    needs_receipt = serializers.SerializerMethodField()
    on_the_road = serializers.SerializerMethodField()
    totals = serializers.SerializerMethodField()

    class Meta:
        model = Lot
        fields = ['id', 'shipment', 'seller', 'boxes_received', 'boxes_per_pallet', 'tare_g', 'default_price_kg',
                  'currency', 'opened_at', 'closed_at', 'needs_receipt', 'on_the_road', 'totals']
        read_only_fields = fields

    def get_shipment(self, lot: Lot) -> dict:
        """The lot's truck."""
        return shipment_brief(lot.shipment)

    def get_seller(self, lot: Lot) -> dict | None:
        """The assigned seller, or None."""
        return _person(lot.seller)

    def get_needs_receipt(self, lot: Lot) -> bool:
        """True while the agent must set the real box count (see totals.needs_receipt)."""
        return needs_receipt(lot)

    def get_on_the_road(self, lot: Lot) -> bool:
        """True while the truck is not past destination customs: no sale or write-off yet."""
        shipment = lot.shipment
        return shipment.status_id is not None and shipment.status.code in ON_THE_ROAD_CODES

    def get_totals(self, lot: Lot) -> dict:
        """lot_totals() with Decimals as strings."""
        return {k: str(v) if isinstance(v, Decimal) else v for k, v in lot_totals(lot).items()}


class SaleSerializer(serializers.ModelSerializer):
    """One sale off a lot."""

    buyer = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = ['id', 'unit', 'qty', 'boxes', 'gross_kg', 'tare_g', 'net_kg', 'price_kg', 'calc_total', 'total',
                  'paid_on_spot', 'buyer', 'sold_at', 'created_by']
        read_only_fields = fields

    def get_buyer(self, sale: Sale) -> dict | None:
        """The debt buyer as `{id, name}`, or None."""
        return {'id': sale.buyer_id, 'name': sale.buyer.name} if sale.buyer_id else None


class SpoilageSerializer(serializers.ModelSerializer):
    """Boxes / kg written off a lot."""

    class Meta:
        model = Spoilage
        fields = ['id', 'boxes', 'gross_kg', 'tare_g', 'net_kg', 'recorded_at', 'created_by']
        read_only_fields = fields


class LotExpenseSerializer(serializers.ModelSerializer):
    """A selling cost on a lot."""

    category_code = serializers.CharField(source='category.code', read_only=True)

    class Meta:
        model = LotExpense
        fields = ['id', 'category_id', 'category_code', 'label', 'amount', 'recorded_at', 'created_by']
        read_only_fields = fields


class LotDetailSerializer(LotSerializer):
    """A lot with its sales, spoilage and expenses, newest first."""

    sales = SaleSerializer(many=True, read_only=True)
    spoilage = SpoilageSerializer(many=True, read_only=True)
    expenses = LotExpenseSerializer(many=True, read_only=True)

    class Meta(LotSerializer.Meta):
        fields = [*LotSerializer.Meta.fields, 'sales', 'spoilage', 'expenses']
        read_only_fields = fields


class LotUpdateSerializer(serializers.Serializer):
    """The agent's PATCH: types only — the rules live in services.lots.update_lot."""

    seller_id = serializers.IntegerField(required=False, allow_null=True)
    boxes_received = serializers.IntegerField(required=False)
    boxes_per_pallet = serializers.IntegerField(required=False)
    tare_g = serializers.IntegerField(required=False)
    default_price_kg = serializers.DecimalField(required=False, allow_null=True, **MONEY)


class OpenLotSerializer(serializers.Serializer):
    """`POST /market/lots/open/` body."""

    shipment_id = serializers.IntegerField()


class AvailableShipmentSerializer(serializers.ModelSerializer):
    """A truck the agent may open, with its lot id if one is open (annotated `lot_id`)."""

    code = serializers.CharField(source='shipment_code', read_only=True)
    status_code = serializers.CharField(source='status.code', read_only=True)
    product = serializers.SerializerMethodField()
    lot_id = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = Shipment
        fields = ['id', 'code', 'export_code', 'status_code', 'box_count', 'pallet_count', 'product', 'lot_id']
        read_only_fields = fields

    def get_product(self, shipment: Shipment) -> dict | None:
        """The product as `{code, name_ru}`, or None."""
        return _product(shipment)


class BuyerSerializer(serializers.ModelSerializer):
    """A buyer of the agent: `{id, name, phone}`; name and phone are the POST body."""

    name = serializers.CharField(max_length=60)
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default='')

    class Meta:
        model = Buyer
        fields = ['id', 'name', 'phone']
        read_only_fields = ['id']
        # Uniqueness is get-or-create in services.reference, not a validation error.
        validators = []
