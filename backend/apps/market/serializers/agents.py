from django.db import transaction
from rest_framework import serializers

from apps.core.models import Customer, User
from apps.market.models import AgentMember
from apps.market.passwords import check_login_password


class AgentLoginSerializer(serializers.ModelSerializer):
    customer = serializers.SerializerMethodField()
    customer_id = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), write_only=True, source='customer_obj')
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'is_active', 'customer', 'customer_id', 'password']
        read_only_fields = ['id']

    def get_fields(self):
        fields = super().get_fields()
        if self.instance is not None:
            fields['username'].read_only = True
        return fields

    def get_customer(self, user) -> dict:
        c = user.agent_member.customer
        return {'id': c.pk, 'name': c.name}

    def validate(self, attrs):
        if self.instance is None and not attrs.get('password'):
            raise serializers.ValidationError({'password': 'Обязательное поле.'})
        if self.instance is not None:
            attrs.pop('customer_obj', None)  # an agent login never moves to another customer
        password = attrs.get('password')
        if password:
            check_login_password(password, self.instance or User(
                username=attrs.get('username', ''), first_name=attrs.get('first_name', '')))
        return attrs

    @transaction.atomic
    def create(self, validated):
        customer = validated.pop('customer_obj')
        password = validated.pop('password')
        user = User(role='agent', **validated)
        user.set_password(password)
        user.save()
        AgentMember.objects.create(user=user, customer=customer)
        return user

    def update(self, user, validated):
        password = validated.pop('password', None)
        for key, value in validated.items():
            setattr(user, key, value)
        if password:
            user.set_password(password)
        user.save()
        return user
