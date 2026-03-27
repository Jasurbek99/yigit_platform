from rest_framework import serializers
from apps.core.models import User, Country, ExportFirm, ShipmentStatusType


class UserMeSerializer(serializers.ModelSerializer):
    """Returned after login and on GET /auth/me/."""

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role']
        read_only_fields = fields


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class CountrySerializer(serializers.ModelSerializer):
    class Meta:
        model = Country
        fields = ['id', 'name_tk', 'name_ru', 'name_en', 'code']


class ExportFirmSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExportFirm
        fields = ['id', 'code', 'name_tk', 'name_ru', 'name_en', 'is_active']


class ShipmentStatusTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShipmentStatusType
        fields = ['id', 'code', 'name_tk', 'name_en', 'name_ru', 'step_order', 'required_role', 'phase']
