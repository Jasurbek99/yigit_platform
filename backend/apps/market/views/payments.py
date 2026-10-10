"""Buyer payments, «Отметить оплату» and the debts list. Rules live in apps.market.services.payments."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.idempotency import idempotent
from apps.market.models import Sale
from apps.market.serializers.payments import BuyerDebtSerializer, PaymentInputSerializer, PaymentSerializer
from apps.market.services.payments import buyer_debts, create_payment, debt_totals, delete_payment, mark_sale_paid
from apps.market.views.base import answers_errors
from apps.market.views.entries import _lot_payload
from apps.market.views.lots import _LotResource


class DebtsView(_LotResource, APIView):
    """`GET /market/debts/`: `{totals: {currency: due}, buyers: [group, ...]}` over the caller's scope."""

    def get(self, request):
        """Who owes what, per buyer and currency."""
        return Response({
            'totals': debt_totals(request.user),
            'buyers': BuyerDebtSerializer(buyer_debts(request.user), many=True).data,
        })


class PaymentCreateView(_LotResource, APIView):
    """`POST /market/payments/`: a buyer pays; 201 `{payment, debts_total}`."""

    @idempotent
    @answers_errors
    def post(self, request):
        """Record the payment and spread it over the buyer's unpaid sales, oldest first."""
        body = PaymentInputSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        payment = create_payment(request.user, data['buyer_id'], data['currency'], data.get('amount'))
        return Response({'payment': PaymentSerializer(payment).data, 'debts_total': debt_totals(request.user)},
                        status=status.HTTP_201_CREATED)


class PaymentDetailView(_LotResource, APIView):
    """`DELETE /market/payments/{id}/`: undo a payment; 200 `{deleted: id}`."""

    @idempotent
    @answers_errors
    def delete(self, request, pk: int):
        """The author or the agent undoes the payment; the sales owe again."""
        delete_payment(request.user, pk)
        return Response({'deleted': pk})


class MarkSalePaidView(_LotResource, APIView):
    """`POST /market/sales/{id}/mark-paid/`: the buyer paid this sale in full; 201 `{payment, lot}`."""

    @idempotent
    @answers_errors
    def post(self, request, pk: int):
        """Record a payment of the sale's whole due."""
        payment = mark_sale_paid(request.user, pk)
        lot_id = Sale.objects.values_list('lot_id', flat=True).get(pk=pk)
        return Response({'payment': PaymentSerializer(payment).data, 'lot': _lot_payload(lot_id)},
                        status=status.HTTP_201_CREATED)
