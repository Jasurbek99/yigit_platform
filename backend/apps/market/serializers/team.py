from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from apps.core.models import City, User
from apps.market.models import AgentMember, Bazaar


class BazaarSerializer(serializers.ModelSerializer):
    city_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = Bazaar
        fields = ['id', 'name', 'city_id', 'is_active']

    def validate_city_id(self, value):
        if value is not None and not City.objects.filter(pk=value).exists():
            raise serializers.ValidationError('Unknown city.')
        return value

    def validate_name(self, value):
        # customer is not a serializer field, so DRF's unique-together check does not run.
        customer = self.context.get('customer')
        clash = Bazaar.objects.filter(customer=customer, name=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if customer is not None and clash.exists():
            raise serializers.ValidationError('A bazaar with this name already exists.')
        return value


class SellerSerializer(serializers.ModelSerializer):
    bazaar = serializers.SerializerMethodField()
    bazaar_id = serializers.IntegerField(write_only=True, required=False)
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'is_active', 'bazaar', 'bazaar_id', 'password']
        read_only_fields = ['id']

    def get_fields(self):
        fields = super().get_fields()
        if self.instance is not None:
            fields['username'].read_only = True
        return fields

    def get_bazaar(self, user) -> dict | None:
        b = user.agent_member.bazaar
        return {'id': b.pk, 'name': b.name} if b else None

    def validate_bazaar_id(self, value):
        customer = self.context['customer']
        if not Bazaar.objects.filter(pk=value, customer=customer, is_active=True).exists():
            raise serializers.ValidationError('Unknown bazaar.')
        return value

    def validate(self, attrs):
        if self.instance is None:
            for key in ('password', 'bazaar_id'):
                if not attrs.get(key):
                    raise serializers.ValidationError({key: 'Required.'})
        password = attrs.get('password')
        if password:
            candidate = self.instance or User(
                username=attrs.get('username', ''), first_name=attrs.get('first_name', ''))
            try:
                validate_password(password, user=candidate)
            except DjangoValidationError as e:
                raise serializers.ValidationError({'password': list(e.messages)})
        return attrs

    @transaction.atomic
    def create(self, validated):
        password = validated.pop('password')
        bazaar_id = validated.pop('bazaar_id')
        user = User(role='agent_seller', **validated)
        user.set_password(password)
        user.save()
        AgentMember.objects.create(user=user, customer=self.context['customer'], bazaar_id=bazaar_id)
        return user

    @transaction.atomic
    def update(self, user, validated):
        password = validated.pop('password', None)
        bazaar_id = validated.pop('bazaar_id', None)
        for key, value in validated.items():
            setattr(user, key, value)
        if password:
            user.set_password(password)
        user.save()
        if bazaar_id:
            member = user.agent_member
            member.bazaar_id = bazaar_id
            member.save(update_fields=['bazaar'])
        return user
