from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from apps.transport.models import DevicePosition, TraccarDevice, TruckHead
from apps.transport.services.matching import device_for_plate


class LivePositionSerializer(serializers.ModelSerializer):
    """DB columns -> API field names (per api-contract)."""

    device_id = serializers.IntegerField(source='device.traccar_id')
    plate = serializers.CharField(source='device.truck.plate', default=None)
    fleet_no = serializers.CharField(source='device.truck.fleet_no', default=None)
    status = serializers.CharField(source='device.status')
    lat = serializers.FloatField(source='latitude')
    lon = serializers.FloatField(source='longitude')
    speed = serializers.FloatField(allow_null=True, required=False)
    course = serializers.FloatField(allow_null=True, required=False)
    is_online = serializers.SerializerMethodField()
    is_stale = serializers.SerializerMethodField()

    class Meta:
        model = DevicePosition
        fields = [
            'device_id', 'plate', 'fleet_no', 'status',
            'lat', 'lon', 'speed', 'course', 'address',
            'fix_time', 'is_online', 'is_stale',
        ]

    def get_is_online(self, obj: DevicePosition) -> bool:
        return obj.device.status == 'online'

    def get_is_stale(self, obj: DevicePosition) -> bool:
        if not obj.fix_time:
            return True
        age = timezone.now() - obj.fix_time
        return age.total_seconds() > settings.TRACCAR_STALE_MINUTES * 60


class TransportDeviceSerializer(serializers.ModelSerializer):
    """Registry device for the override picker (all devices, not just positioned)."""

    plate = serializers.CharField(source='truck.plate', default=None)
    fleet_no = serializers.CharField(source='truck.fleet_no', default=None)

    class Meta:
        model = TraccarDevice
        fields = ['traccar_id', 'plate', 'fleet_no', 'name']


class TruckHeadSerializer(serializers.ModelSerializer):
    has_gps = serializers.SerializerMethodField()

    class Meta:
        model = TruckHead
        fields = ['id', 'plate_number', 'owner_type', 'owner_name', 'status',
                  'capacity', 'is_active', 'has_gps']
        read_only_fields = ['id', 'has_gps']

    def get_has_gps(self, obj) -> bool:
        return obj.traccar_device_id is not None

    def create(self, validated_data):
        # plate-match a Traccar device on create (like the import)
        validated_data['traccar_device'] = device_for_plate(validated_data['plate_number'])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # A plate correction must re-match the device — the resolver returns
        # TruckHead.traccar_device authoritatively (no fall-through) once a
        # shipment has a truck_head_id, so a stale link would silently point
        # at the wrong truck's GPS. Re-matching also clears it to None when
        # the new plate has no match.
        if 'plate_number' in validated_data:
            validated_data['traccar_device'] = device_for_plate(validated_data['plate_number'])
        return super().update(instance, validated_data)
