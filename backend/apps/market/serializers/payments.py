"""Payments and the debts list. Money goes out as strings; the request body is types only —
the rules (and their Russian messages) live in apps.market.services.payments.
"""
from rest_framework import serializers

from apps.market.models import Payment

MONEY = {'max_digits': 12, 'decimal_places': 2}


class PaymentInputSerializer(serializers.Serializer):
    """`POST /market/payments/`: `{buyer_id, currency, amount}`."""

    buyer_id = serializers.IntegerField()
    currency = serializers.CharField(max_length=3)
    amount = serializers.DecimalField(required=False, allow_null=True, **MONEY)


class PaymentSerializer(serializers.ModelSerializer):
    """A recorded payment: `{id, buyer: {id, name}, currency, amount, paid_at}`."""

    buyer = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = ['id', 'buyer', 'currency', 'amount', 'paid_at']
        read_only_fields = fields

    def get_buyer(self, payment: Payment) -> dict:
        """The paying buyer."""
        return {'id': payment.buyer_id, 'name': payment.buyer.name}


class _RefSerializer(serializers.Serializer):
    """`{id, name}` of a buyer or a user."""

    id = serializers.IntegerField()
    name = serializers.CharField()


class DebtSaleSerializer(serializers.Serializer):
    """One unpaid sale in a buyer's debt group."""

    id = serializers.IntegerField()
    lot_id = serializers.IntegerField()
    shipment_code = serializers.CharField()
    sold_at = serializers.DateTimeField()
    unit = serializers.CharField()
    boxes = serializers.IntegerField()
    net_kg = serializers.DecimalField(**MONEY)
    total = serializers.DecimalField(**MONEY)
    due = serializers.DecimalField(**MONEY)


class DebtPaymentSerializer(serializers.Serializer):
    """One of the buyer's latest payments: `{id, amount, paid_at, created_by: {id, name}}`.

    `amount` is the part allocated to sales in the caller's scope.
    """

    id = serializers.IntegerField()
    amount = serializers.DecimalField(**MONEY)
    paid_at = serializers.DateTimeField()
    created_by = _RefSerializer()


class BuyerDebtSerializer(serializers.Serializer):
    """A group of services.payments.buyer_debts(): one buyer in one currency.

    A paid-off group (kept 30 days after a payment) has `due` 0, `since` null and no sales.
    """

    buyer = _RefSerializer()
    currency = serializers.CharField()
    due = serializers.DecimalField(**MONEY)
    since = serializers.DateTimeField(allow_null=True)
    sales = DebtSaleSerializer(many=True)
    payments = DebtPaymentSerializer(many=True)
