from rest_framework import serializers
from apps.core.models import (
    User, City, Country, BorderPoint, ExportFirm, ImportFirm, ShipmentStatusType,
    ShipmentOptionType, Customer, GreenhouseBlock, LoadingLocation, TomatoVariety,
    TruckDestination, CrateType,
)
from apps.core.permissions import get_editable_fields


class UserMeSerializer(serializers.ModelSerializer):
    """Returned after login and on GET /auth/me/."""

    editable_fields = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'is_superuser', 'editable_fields', 'permissions',
        ]
        read_only_fields = fields

    def get_editable_fields(self, obj: User) -> list[str]:
        return get_editable_fields(obj.role)

    def get_permissions(self, obj: User) -> list[str]:
        """Return granted Django permission codenames.

        Superusers have all permissions — return ['*'] so the frontend
        can treat this as a wildcard without enumerating every codename.
        """
        if obj.is_superuser:
            return ['*']
        return list(obj.user_permissions.values_list('codename', flat=True))


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class CountrySerializer(serializers.ModelSerializer):
    class Meta:
        model = Country
        fields = ['id', 'name_tk', 'name_ru', 'name_en', 'code']


class CitySerializer(serializers.ModelSerializer):
    class Meta:
        model = City
        fields = ['id', 'name', 'name_local', 'country']


class ExportFirmReferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExportFirm
        fields = ['id', 'code', 'name_tk', 'name_ru', 'name_en', 'is_active', 'is_gapy_satys']


class ShipmentStatusTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShipmentStatusType
        fields = ['id', 'code', 'name_tk', 'name_en', 'name_ru', 'step_order', 'required_role', 'phase']


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ['id', 'name', 'phone', 'default_country', 'is_active']


class CustomerAdminSerializer(serializers.ModelSerializer):
    """Full Customer serializer for admin CRUD — includes country/city names and import firms."""

    country_name = serializers.CharField(source='default_country.name_en', read_only=True, default=None)
    city_name = serializers.CharField(source='default_city.name', read_only=True, default=None)
    import_firms = serializers.PrimaryKeyRelatedField(
        many=True, queryset=ImportFirm.objects.all(), required=False,
    )
    import_firm_names = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = [
            'id', 'name', 'phone',
            'default_country', 'country_name',
            'default_city', 'city_name',
            'import_firms', 'import_firm_names',
            'is_active',
        ]

    def get_import_firm_names(self, obj: Customer) -> list[dict]:
        return [
            {'id': f.id, 'name': f.name_short or f.name_company}
            for f in obj.import_firms.all()
        ]


class GreenhouseBlockSerializer(serializers.ModelSerializer):
    class Meta:
        model = GreenhouseBlock
        fields = ['id', 'code', 'name', 'is_active']


class LoadingLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoadingLocation
        fields = ['id', 'name']


class TomatoVarietySerializer(serializers.ModelSerializer):
    class Meta:
        model = TomatoVariety
        fields = [
            'id', 'name', 'type', 'avg_fruit_weight_gr',
            'code', 'is_experimental', 'scientific_name',
        ]


class CrateTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = CrateType
        fields = ['id', 'name', 'weight_kg', 'is_active']


class TruckDestinationSerializer(serializers.ModelSerializer):
    country_name = serializers.CharField(source='country.name_en', read_only=True, default=None)

    class Meta:
        model = TruckDestination
        fields = ['id', 'name', 'country', 'country_name', 'sort_order', 'is_active']


class BorderPointSerializer(serializers.ModelSerializer):
    class Meta:
        model = BorderPoint
        fields = ['id', 'name', 'route_description', 'typical_transit_days', 'is_active']


class ShipmentOptionTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShipmentOptionType
        fields = ['id', 'category', 'code', 'label_tk', 'label_en', 'label_ru', 'icon', 'sort_order', 'is_active']
