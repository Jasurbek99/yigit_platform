from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import User
from apps.core.models.user import AGENT_SELLER_ROLE
from apps.core.permissions import DynamicResourcePermission
from apps.market.models import Bazaar
from apps.market.scoping import customer_ids_for
from apps.market.serializers.team import BazaarSerializer, SellerSerializer
from apps.market.services import build_me_payload, own_team_customer
from apps.market.views.base import LoginAuditMixin, RussianMixin


class _TeamBase(RussianMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                mixins.UpdateModelMixin, viewsets.GenericViewSet):
    resource_code = 'market_team'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    http_method_names = ['get', 'post', 'patch']

    def _scope(self, qs, field='customer_id'):
        ids = customer_ids_for(self.request.user)
        return qs if ids is None else qs.filter(**{f'{field}__in': ids})

    def get_serializer_context(self):
        """On a write, add the caller's own customer (403 unless the caller is the agent)."""
        ctx = super().get_serializer_context()
        if self.request.method not in ('GET', 'HEAD', 'OPTIONS'):
            ctx['customer'] = own_team_customer(self.request.user)
        return ctx


class BazaarViewSet(_TeamBase):
    """The agent's bazaars."""

    serializer_class = BazaarSerializer

    def get_queryset(self):
        """Bazaars of the customers the caller may see."""
        return self._scope(Bazaar.objects.all())

    def perform_create(self, serializer):
        """Create the bazaar for the agent's own customer."""
        serializer.save(customer=own_team_customer(self.request.user))


class SellerViewSet(LoginAuditMixin, _TeamBase):
    """The agent's seller logins (role `agent_seller`)."""

    serializer_class = SellerSerializer
    audit_model = 'SellerLogin'

    def get_queryset(self):
        """Seller logins of the customers the caller may see; `?active=1` for active ones only."""
        qs = (User.objects.filter(role=AGENT_SELLER_ROLE, agent_member__isnull=False)
              .select_related('agent_member__bazaar'))
        if self.request.query_params.get('active') == '1':
            qs = qs.filter(is_active=True)
        return self._scope(qs, 'agent_member__customer_id').order_by('first_name', 'username')


class MarketMeView(RussianMixin, APIView):
    """`GET /market/me/`: who is using the market app."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Return the caller's role, names, customer and bazaar."""
        return Response(build_me_payload(request.user))
