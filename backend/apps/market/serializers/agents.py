from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

from apps.core.models import Customer, User
from apps.market.models import AgentMember


class AgentLoginSerializer(serializers.ModelSerializer):
    customer = serializers.SerializerMethodField()
    customer_id = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), write_only=True, source='customer_obj')
    password = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'is_active', 'customer', 'customer_id', 'password']
        read_only_fields = ['id']

    def get_customer(self, user) -> dict:
        c = user.agent_member.customer
        return {'id': c.pk, 'name': c.name}

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get('password'):
            raise serializers.ValidationError({'password': 'Required.'})
        if self.instance is not None:
            attrs.pop('customer_obj', None)  # an agent login never moves to another customer
            attrs.pop('username', None)
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
