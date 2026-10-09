from django.db import transaction
from rest_framework import serializers

from apps.core.models import City, User
from apps.core.models.user import AGENT_SELLER_ROLE
from apps.market.models import AgentMember, Bazaar
from apps.market.serializers.logins import LoginSerializerMixin


class BazaarSerializer(serializers.ModelSerializer):
    """One of the agent's bazaars. The writing agent's customer comes in `context['customer']`."""

    city_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = Bazaar
        fields = ['id', 'name', 'city_id', 'is_active']

    def validate_city_id(self, value: int | None) -> int | None:
        """Refuse an unknown city."""
        if value is not None and not City.objects.filter(pk=value).exists():
            raise serializers.ValidationError('Неизвестный город.')
        return value

    def validate_name(self, value: str) -> str:
        """Refuse a name the agent already uses for another bazaar."""
        # customer is not a serializer field, so DRF's unique-together check does not run.
        customer = self.context.get('customer')
        clash = Bazaar.objects.filter(customer=customer, name=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if customer is not None and clash.exists():
            raise serializers.ValidationError('Базар с таким названием уже есть.')
        return value


class SellerSerializer(LoginSerializerMixin, serializers.ModelSerializer):
    """A seller login (role `agent_seller`) at one of the agent's bazaars."""

    bazaar = serializers.SerializerMethodField()
    bazaar_id = serializers.IntegerField(write_only=True, required=False)
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)

    login_role = AGENT_SELLER_ROLE

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'is_active', 'bazaar', 'bazaar_id', 'password']
        read_only_fields = ['id']

    def get_bazaar(self, user: User) -> dict | None:
        """The seller's bazaar as `{id, name}`, or None if unbound."""
        b = user.agent_member.bazaar
        return {'id': b.pk, 'name': b.name} if b else None

    def validate_bazaar_id(self, value: int) -> int:
        """Only an active bazaar of the writing agent."""
        customer = self.context['customer']
        if not Bazaar.objects.filter(pk=value, customer=customer, is_active=True).exists():
            raise serializers.ValidationError('Неизвестный базар.')
        return value

    def validate(self, attrs: dict) -> dict:
        """Password and bazaar required on create; password rules on any new password."""
        self.check_login(attrs, ('password', 'bazaar_id'))
        return attrs

    @transaction.atomic
    def create(self, validated: dict) -> User:
        """Create the seller user, bound to the agent's customer and a bazaar."""
        bazaar_id = validated.pop('bazaar_id')
        user = self.create_login(validated)
        AgentMember.objects.create(user=user, customer=self.context['customer'], bazaar_id=bazaar_id)
        return user

    @transaction.atomic
    def update(self, user: User, validated: dict) -> User:
        """Update names, is_active and the password; move the seller to another bazaar."""
        bazaar_id = validated.pop('bazaar_id', None)
        user = self.update_login(user, validated)
        if bazaar_id:
            member = user.agent_member
            member.bazaar_id = bazaar_id
            member.save(update_fields=['bazaar'])
        return user
