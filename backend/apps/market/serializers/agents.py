from django.db import transaction
from rest_framework import serializers

from apps.core.models import Customer, User
from apps.core.models.user import AGENT_ROLE
from apps.market.models import AgentMember
from apps.market.serializers.logins import LoginSerializerMixin


class AgentLoginSerializer(LoginSerializerMixin, serializers.ModelSerializer):
    """An agent login (role `agent`) bound to its customer, as staff create and edit it."""

    customer = serializers.SerializerMethodField()
    customer_id = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), write_only=True, source='customer_obj')
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)

    login_role = AGENT_ROLE

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'is_active', 'customer', 'customer_id', 'password']
        read_only_fields = ['id']

    def get_customer(self, user: User) -> dict:
        """The agent's customer as `{id, name}`."""
        c = user.agent_member.customer
        return {'id': c.pk, 'name': c.name}

    def validate(self, attrs: dict) -> dict:
        """Password required on create; an existing login never moves to another customer."""
        self.check_login(attrs, ('password',))
        if self.instance is not None:
            attrs.pop('customer_obj', None)
        return attrs

    @transaction.atomic
    def create(self, validated: dict) -> User:
        """Create the agent user and its AgentMember."""
        customer = validated.pop('customer_obj')
        user = self.create_login(validated)
        AgentMember.objects.create(user=user, customer=customer)
        return user

    def update(self, user: User, validated: dict) -> User:
        """Update names, is_active and the password."""
        return self.update_login(user, validated)
