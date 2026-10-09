from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import User
from apps.core.permissions import DynamicResourcePermission
from apps.market.models import Bazaar
from apps.market.scoping import customer_ids_for, member_of
from apps.market.serializers.team import BazaarSerializer, SellerSerializer
from apps.market.views.base import LoginAuditMixin, RussianMixin


class _TeamBase(RussianMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                mixins.UpdateModelMixin, viewsets.GenericViewSet):
    resource_code = 'market_team'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    http_method_names = ['get', 'post', 'patch']

    def _scope(self, qs, field='customer_id'):
        ids = customer_ids_for(self.request.user)
        return qs if ids is None else qs.filter(**{f'{field}__in': ids})

    def _own_customer(self):
        """Team writes belong to the agent itself — staff only read."""
        member = member_of(self.request.user)
        if self.request.user.role != 'agent' or member is None:
            raise PermissionDenied('Командой управляет только агент.')
        return member.customer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.request.method not in ('GET', 'HEAD', 'OPTIONS'):
            ctx['customer'] = self._own_customer()
        return ctx


class BazaarViewSet(_TeamBase):
    serializer_class = BazaarSerializer

    def get_queryset(self):
        return self._scope(Bazaar.objects.all())

    def perform_create(self, serializer):
        serializer.save(customer=self._own_customer())


class SellerViewSet(LoginAuditMixin, _TeamBase):
    serializer_class = SellerSerializer
    audit_model = 'SellerLogin'

    def get_queryset(self):
        qs = User.objects.filter(role='agent_seller', agent_member__isnull=False).select_related('agent_member__bazaar')
        if self.request.query_params.get('active') == '1':
            qs = qs.filter(is_active=True)
        return self._scope(qs, 'agent_member__customer_id').order_by('first_name', 'username')


class MarketMeView(RussianMixin, APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = member_of(request.user)
        return Response({
            'role': request.user.role,
            'customer': {'id': member.customer_id, 'name': member.customer.name} if member else None,
            'bazaar': ({'id': member.bazaar_id, 'name': member.bazaar.name}
                       if member and member.bazaar_id else None),
        })
