"""Lots API and the reference lists of the market phone app. Rules live in apps.market.services."""
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.idempotency import idempotent
from apps.core.permissions import DynamicResourcePermission
from apps.market.serializers.lots import (
    AvailableShipmentSerializer,
    BuyerSerializer,
    LotDetailSerializer,
    LotSerializer,
    LotUpdateSerializer,
    OpenLotSerializer,
)
from apps.market.services import (
    available_shipments,
    get_or_create_buyer,
    lots_for,
    market_expense_categories,
    open_lot,
    search_buyers,
    update_lot,
)
from apps.market.views.base import RussianMixin, answers_errors
from apps.market.views.entries import LotEntriesMixin


class _LotResource(RussianMixin):
    """Gated on the `market_lot` resource; finer rules are in the services."""

    resource_code = 'market_lot'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]


class LotViewSet(_LotResource, LotEntriesMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                 viewsets.GenericViewSet):
    """`/market/lots/`: list (`?state=open|closed`), detail, open (`POST open/`), agent PATCH,
    and the lot's sales / spoilage / expenses (LotEntriesMixin).

    DELETE is only for the entry routes: there is no destroy, so `lots/{id}/` answers 405.
    """

    http_method_names = ['get', 'post', 'patch', 'delete']
    lookup_value_regex = r'\d+'

    def get_queryset(self):
        """The lots the caller may see (not season-scoped)."""
        qs = lots_for(self.request.user).select_related('shipment__status', 'shipment__product_type', 'seller')
        state = self.request.query_params.get('state')
        if state in ('open', 'closed'):
            qs = qs.filter(closed_at__isnull=state == 'open')
        if self.action == 'retrieve':
            qs = qs.prefetch_related('sales__buyer', 'sales__allocations', 'spoilage', 'expenses__category')
        return qs

    def get_serializer_class(self):
        """Detail adds the lot's sales, spoilage and expenses."""
        return LotDetailSerializer if self.action == 'retrieve' else LotSerializer

    def partial_update(self, request, pk=None):
        """The agent sets the seller and the receipt."""
        lot = self.get_object()
        data = LotUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        lot = update_lot(request.user, lot, data.validated_data)
        return Response(LotSerializer(lot).data)

    @action(detail=False, methods=['post'])
    @idempotent
    @answers_errors
    def open(self, request):
        """Open the lot of a shipment: 201 when created, 200 when it already existed."""
        body = OpenLotSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        lot, created = open_lot(request.user, body.validated_data['shipment_id'])
        return Response(LotSerializer(lot).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class AvailableShipmentsView(_LotResource, APIView):
    """`GET /market/shipments/`: the agent's trucks, arrived first, then in transit."""

    def get(self, request):
        """The trucks the agent may open a lot on."""
        return Response(AvailableShipmentSerializer(available_shipments(request.user), many=True).data)


class ExpenseCategoryListView(_LotResource, APIView):
    """`GET /market/expense-categories/`: the selling-cost categories, in market order."""

    def get(self, request):
        """`[{id, code, label}]`."""
        return Response(market_expense_categories())


class BuyerListView(_LotResource, APIView):
    """`/market/buyers/`: autocomplete (`?q=`, max 20) and get-or-create by name."""

    def get(self, request):
        """Buyers whose name contains `q`."""
        q = request.query_params.get('q', '').strip()
        return Response(BuyerSerializer(search_buyers(request.user, q), many=True).data)

    @idempotent
    @answers_errors
    def post(self, request):
        """Return the buyer with this name (any case), creating it if new: 201 created, 200 found."""
        body = BuyerSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        buyer, created = get_or_create_buyer(request.user, body.validated_data['name'],
                                             body.validated_data.get('phone', ''))
        return Response(BuyerSerializer(buyer).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
