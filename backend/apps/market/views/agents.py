from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated

from apps.core.models import User
from apps.core.models.user import AGENT_ROLE
from apps.core.permissions import DynamicResourcePermission
from apps.market.scoping import customer_ids_for
from apps.market.serializers.agents import AgentLoginSerializer
from apps.market.services import check_customer_in_scope
from apps.market.views.base import LoginAuditMixin, RussianMixin


class AgentLoginViewSet(RussianMixin, LoginAuditMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                        mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Our staff create and manage agent logins (role `agent`)."""

    resource_code = 'market_agent'
    permission_classes = [IsAuthenticated, DynamicResourcePermission]
    serializer_class = AgentLoginSerializer
    audit_model = 'AgentLogin'
    http_method_names = ['get', 'post', 'patch']

    def get_queryset(self):
        """Agent logins of the customers the caller may see."""
        qs = User.objects.filter(role=AGENT_ROLE, agent_member__isnull=False).select_related('agent_member__customer')
        ids = customer_ids_for(self.request.user)
        if ids is not None:
            qs = qs.filter(agent_member__customer_id__in=ids)
        return qs.order_by('agent_member__customer__name', 'username')

    def perform_create(self, serializer):
        """Create the login only for a customer in the caller's scope (403 otherwise)."""
        check_customer_in_scope(self.request.user, serializer.validated_data['customer_obj'])
        super().perform_create(serializer)
