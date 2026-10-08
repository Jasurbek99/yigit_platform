from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from apps.core.models import User
from apps.core.permissions import DynamicResourcePermission
from apps.market.scoping import customer_ids_for
from apps.market.serializers.agents import AgentLoginSerializer


class AgentLoginViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
                        mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Our staff create and manage agent logins (role `agent`)."""

    resource_code = 'market_agent'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = AgentLoginSerializer
    http_method_names = ['get', 'post', 'patch']

    def get_queryset(self):
        qs = User.objects.filter(role='agent', agent_member__isnull=False).select_related('agent_member__customer')
        ids = customer_ids_for(self.request.user)
        if ids is not None:
            qs = qs.filter(agent_member__customer_id__in=ids)
        return qs.order_by('agent_member__customer__name', 'username')

    def perform_create(self, serializer):
        ids = customer_ids_for(self.request.user)
        customer = serializer.validated_data['customer_obj']
        if ids is not None and customer.pk not in ids:
            raise PermissionDenied('Not your customer.')
        serializer.save()
