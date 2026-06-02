import zoneinfo
from decimal import Decimal

from rest_framework import serializers
from apps.core.models import (
    User, City, Country, BorderPoint, ExportFirm, ImportFirm, ShipmentStatusType,
    ShipmentOptionType, Customer, GreenhouseBlock, LoadingLocation, TomatoVariety,
    TruckDestination, CrateType, GreenhouseConfig, OperatingDayException,
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
        fields = ['id', 'name_tk', 'name_ru', 'name_en', 'code', 'color', 'sort_order']


class CitySerializer(serializers.ModelSerializer):
    class Meta:
        model = City
        fields = ['id', 'name', 'name_local', 'country', 'color', 'sort_order']


class ExportFirmReferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExportFirm
        fields = ['id', 'code', 'name_tk', 'name_ru', 'name_en', 'color', 'sort_order', 'is_active', 'is_gapy_satys']


class ShipmentStatusTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShipmentStatusType
        fields = ['id', 'code', 'name_tk', 'name_en', 'name_ru', 'step_order', 'required_role', 'phase']


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ['id', 'name', 'phone', 'default_country', 'color', 'sort_order', 'is_active']


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
            'color', 'sort_order',
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
        fields = ['id', 'code', 'name', 'color', 'sort_order', 'is_active']


class LoadingLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoadingLocation
        fields = ['id', 'name']


class TomatoVarietySerializer(serializers.ModelSerializer):
    class Meta:
        model = TomatoVariety
        fields = [
            'id', 'name', 'type', 'avg_fruit_weight_gr',
            'code', 'is_experimental', 'scientific_name', 'color', 'sort_order',
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
        fields = ['id', 'name', 'route_description', 'typical_transit_days', 'color', 'sort_order', 'is_active']


class ShipmentOptionTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShipmentOptionType
        fields = ['id', 'category', 'code', 'label_tk', 'label_en', 'label_ru', 'icon', 'color', 'sort_order', 'is_active']


class GreenhouseConfigSerializer(serializers.ModelSerializer):
    """Singleton greenhouse-config serializer.

    `updated_by` is set by the view from request.user — never trust the client.
    `updated_by_name` is a derived display field.
    """

    updated_by_name = serializers.SerializerMethodField()
    plan_deadline_weekday = serializers.IntegerField(min_value=0, max_value=6)
    plan_late_until_weekday = serializers.IntegerField(min_value=0, max_value=6)
    plan_critical_late_at_weekday = serializers.IntegerField(min_value=0, max_value=6)
    notification_lead_minutes = serializers.IntegerField(min_value=0, max_value=1440)
    operating_days_bitmask = serializers.IntegerField(min_value=0, max_value=127)
    truck_capacity_kg = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0.01'))
    timezone_name = serializers.CharField(max_length=64, allow_blank=False)

    class Meta:
        model = GreenhouseConfig
        fields = [
            'id',
            'plan_deadline_weekday', 'plan_late_until_weekday',
            'plan_critical_late_at_weekday', 'plan_critical_late_at_time',
            'forecast_primary_open', 'forecast_primary_close',
            'forecast_fallback_close', 'forecast_same_day_close',
            'notification_lead_minutes', 'truck_capacity_kg',
            'operating_days_bitmask', 'timezone_name',
            'updated_by', 'updated_by_name', 'updated_at',
        ]
        read_only_fields = ['id', 'updated_by', 'updated_by_name', 'updated_at']

    def get_updated_by_name(self, obj: GreenhouseConfig) -> str | None:
        if obj.updated_by_id is None:
            return None
        u = obj.updated_by
        full = f'{u.first_name} {u.last_name}'.strip()
        return full or u.username

    def validate_timezone_name(self, value: str) -> str:
        try:
            zoneinfo.ZoneInfo(value)
        except (zoneinfo.ZoneInfoNotFoundError, ValueError):
            raise serializers.ValidationError(f"Unknown IANA timezone: '{value}'.")
        return value


class OperatingDayExceptionSerializer(serializers.ModelSerializer):
    """Calendar-date holiday/exception override.

    `created_by` is set by the view from request.user.
    """

    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OperatingDayException
        fields = [
            'id', 'date', 'is_holiday', 'note',
            'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_by_name', 'created_at']

    def get_created_by_name(self, obj: OperatingDayException) -> str | None:
        if obj.created_by_id is None:
            return None
        u = obj.created_by
        full = f'{u.first_name} {u.last_name}'.strip()
        return full or u.username
