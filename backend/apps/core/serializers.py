from rest_framework import serializers
from apps.core.models import User, Country, ExportFirm, ShipmentStatusType, Customer, GreenhouseBlock
from apps.core.permissions import get_editable_fields


class UserMeSerializer(serializers.ModelSerializer):
    """Returned after login and on GET /auth/me/."""

    editable_fields = serializers.SerializerMethodField()
    managed_block_ids = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'is_superuser', 'editable_fields', 'managed_block_ids',
        ]
        read_only_fields = fields

    def get_editable_fields(self, obj: User) -> list[str]:
        return get_editable_fields(obj.role)

    def get_managed_block_ids(self, obj: User) -> list[int]:
        """Return the list of block IDs this user is assigned to manage.

        Importing BlockManagerAssignment inline to avoid a circular import:
        core cannot import from export at module level.
        Only meaningful for greenhouse_manager role; returns [] for all others.
        """
        if obj.role != 'greenhouse_manager':
            return []
        # Late import — export depends on core, not the other way around.
        from apps.export.models import BlockManagerAssignment  # noqa: PLC0415
        return list(
            BlockManagerAssignment.objects.filter(
                user=obj, is_active=True,
            ).values_list('block_id', flat=True)
        )


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


class GreenhouseBlockSerializer(serializers.ModelSerializer):
    class Meta:
        model = GreenhouseBlock
        fields = ['id', 'code', 'name', 'is_active']
