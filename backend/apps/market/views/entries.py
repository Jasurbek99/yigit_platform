"""Sales, spoilage and expenses on a lot — nested actions of LotViewSet. Rules live in services.entries.

Creates answer 201 `{entry, lot}` (expenses: `{entries, lot}`), deletes 200 `{lot}`, so the
phone updates the lot's totals in one round-trip. The views never call get_object(): the
service scopes by customer, so a seller of the same agent gets 403, not 404.
"""
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.idempotency import idempotent
from apps.market.models import Lot
from apps.market.serializers.entries import ExpensesInputSerializer, SaleInputSerializer, SpoilageInputSerializer
from apps.market.serializers.lots import LotExpenseSerializer, LotSerializer, SaleSerializer, SpoilageSerializer
from apps.market.services import create_expenses, create_sale, create_spoilage, delete_entry
from apps.market.views.base import answers_errors


def _lot_payload(lot_id: int) -> dict:
    """The lot as the lots list shows it, read fresh after the write."""
    lot = Lot.objects.select_related('shipment__status', 'shipment__product_type', 'seller').get(pk=lot_id)
    return LotSerializer(lot).data


def _valid(serializer_class, request) -> dict:
    body = serializer_class(data=request.data)
    body.is_valid(raise_exception=True)
    return body.validated_data


class LotEntriesMixin:
    """`/market/lots/{id}/sales|spoilage|expenses/` POST and `…/{entry_id}/` DELETE."""

    def _deleted(self, request, pk, kind: str, entry_id: str) -> Response:
        delete_entry(request.user, kind, int(entry_id), lot_id=int(pk))
        return Response({'lot': _lot_payload(int(pk))})

    @action(detail=True, methods=['post'], url_path='sales')
    @idempotent
    @answers_errors
    def add_sale(self, request, pk=None):
        """The seller records a sale."""
        sale = create_sale(request.user, int(pk), _valid(SaleInputSerializer, request))
        return Response({'entry': SaleSerializer(sale).data, 'lot': _lot_payload(sale.lot_id)},
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'sales/(?P<entry_id>\d+)')
    @idempotent
    @answers_errors
    def remove_sale(self, request, pk=None, entry_id=None):
        """The author-seller or the agent deletes a sale."""
        return self._deleted(request, pk, 'sale', entry_id)

    @action(detail=True, methods=['post'], url_path='spoilage')
    @idempotent
    @answers_errors
    def add_spoilage(self, request, pk=None):
        """The seller writes boxes / kg off."""
        spoilage = create_spoilage(request.user, int(pk), _valid(SpoilageInputSerializer, request))
        return Response({'entry': SpoilageSerializer(spoilage).data, 'lot': _lot_payload(spoilage.lot_id)},
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'spoilage/(?P<entry_id>\d+)')
    @idempotent
    @answers_errors
    def remove_spoilage(self, request, pk=None, entry_id=None):
        """The author-seller or the agent deletes a spoilage entry."""
        return self._deleted(request, pk, 'spoilage', entry_id)

    @action(detail=True, methods=['post'], url_path='expenses')
    @idempotent
    @answers_errors
    def add_expenses(self, request, pk=None):
        """The seller records one expenses sheet (several rows)."""
        rows = _valid(ExpensesInputSerializer, request)['rows']
        expenses = create_expenses(request.user, int(pk), rows)
        return Response({'entries': LotExpenseSerializer(expenses, many=True).data, 'lot': _lot_payload(int(pk))},
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'expenses/(?P<entry_id>\d+)')
    @idempotent
    @answers_errors
    def remove_expense(self, request, pk=None, entry_id=None):
        """The author-seller or the agent deletes an expense."""
        return self._deleted(request, pk, 'expense', entry_id)
