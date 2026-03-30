from rest_framework import serializers
from apps.core.models import User, Country, ExportFirm, ShipmentStatusType, Customer
from apps.core.permissions import get_editable_fields


class UserMeSerializer(serializers.ModelSerializer):
    """Returned after login and on GET /auth/me/."""

    editable_fields = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'editable_fields']
        read_only_fields = fields

    def get_editable_fields(self, obj: User) -> list[str]:
        return get_editable_fields(obj.role)


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


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ['id', 'name', 'phone', 'default_country', 'is_active']
