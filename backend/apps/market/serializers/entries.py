"""Request bodies for sales, spoilage and expenses: types only — the rules (and their Russian
messages) live in apps.market.services.entries, so nothing here may be required that a rule checks.
"""
from rest_framework import serializers

from apps.market.models import Sale

MONEY = {'max_digits': 12, 'decimal_places': 2}


class SaleInputSerializer(serializers.Serializer):
    """`POST /market/lots/{id}/sales/`."""

    unit = serializers.ChoiceField(choices=Sale.UNIT_CHOICES, default=Sale.UNIT_BOX)
    qty = serializers.IntegerField(required=False, allow_null=True)
    gross_kg = serializers.DecimalField(required=False, allow_null=True, **MONEY)
    price_kg = serializers.DecimalField(required=False, allow_null=True, **MONEY)
    total = serializers.DecimalField(required=False, allow_null=True, **MONEY)
    paid_on_spot = serializers.BooleanField(default=True)
    buyer_id = serializers.IntegerField(required=False, allow_null=True)


class SpoilageInputSerializer(serializers.Serializer):
    """`POST /market/lots/{id}/spoilage/`."""

    boxes = serializers.IntegerField(min_value=0, default=0)
    gross_kg = serializers.DecimalField(required=False, allow_null=True, **MONEY)


class ExpenseRowSerializer(serializers.Serializer):
    """One row of the expenses sheet."""

    category_id = serializers.IntegerField()
    amount = serializers.DecimalField(required=False, allow_null=True, **MONEY)
    label = serializers.CharField(max_length=40, required=False, allow_blank=True, default='')


class ExpensesInputSerializer(serializers.Serializer):
    """`POST /market/lots/{id}/expenses/`: `{rows: [...]}`."""

    rows = ExpenseRowSerializer(many=True, allow_empty=True)
