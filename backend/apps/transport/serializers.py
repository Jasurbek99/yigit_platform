from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from apps.transport.models import (
    DevicePosition, Driver, DriverDocument, TraccarDevice, Trailer, TruckHead,
    TruckHeadDocument,
)
from apps.transport.services.matching import device_for_plate


class LivePositionSerializer(serializers.ModelSerializer):
    """DB columns -> API field names (per api-contract).

    Two timestamps, deliberately both exposed: `fix_time` is when the truck's
    GPS reported, `updated_at` is when our poller last wrote the row. The Fleet
    Map takes max(`updated_at`) across rows as its "data as of" stamp, so a
    dead poller is visible instead of silently serving month-old pins.
    """

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
            'fix_time', 'updated_at', 'is_online', 'is_stale',
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


# Fields the fleet catalog must not be left blank on (2026-09-10, owner request).
# Every imported row starts blank -- 92 of 92 truck heads carry no model, 153 of
# 153 drivers carry no passport -- so this is a fill-in-as-you-go rule, not a
# claim about today's data. It is checked here rather than on the model because
# the TIR import writes those same rows and must keep succeeding.
def require_filled(serializer, validated_data, field_names):
    """Raise unless every named field ends up non-empty after this save.

    Checks the EFFECTIVE value (the incoming one when present, the stored one
    otherwise), so a PATCH cannot leave a blank row blank by simply omitting the
    field. Two deliberate exemptions:

    * An `is_active`-only payload. Deactivation is how a duplicate driver is
      retired (see `Driver` -- a delete would come back on the next import), and
      the row being retired is exactly the one nobody will ever fill in. A
      required field must not make a row impossible to switch off.
    * `partial` saves that touch none of the named fields and already hold a
      value -- covered by the effective-value rule above, no special case.

    Args:
        serializer: the calling serializer (its `instance` supplies stored values).
        validated_data: the incoming data, post-validation.
        field_names: iterable of field names that must end up non-empty.

    Raises:
        serializers.ValidationError: keyed by field name, so the form marks the
            offending input rather than showing a form-level banner.
    """
    if set(validated_data) <= {'is_active'}:
        return

    errors = {}
    for name in field_names:
        if name in validated_data:
            value = validated_data[name]
        else:
            value = getattr(serializer.instance, name, None)
        if value in (None, ''):
            errors[name] = ['This field is required.']
    if errors:
        raise serializers.ValidationError(errors)


class TruckHeadSerializer(serializers.ModelSerializer):
    has_gps = serializers.SerializerMethodField()
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = TruckHead
        fields = ['id', 'plate_number', 'owner_type', 'owner_name', 'status',
                  'truck_model', 'capacity', 'is_active', 'has_gps',
                  'document_count']
        read_only_fields = ['id', 'has_gps', 'document_count']

    def get_has_gps(self, obj) -> bool:
        return obj.traccar_device_id is not None

    def get_document_count(self, obj) -> int:
        # A count, not the documents — safe on the shared picker route, unlike
        # the driver's passport scalars, which need DriverAdminSerializer.
        # Annotated by the viewset; the fallback keeps this usable on the plain
        # instance a create/update response carries.
        count = getattr(obj, 'document_count_annotated', None)
        return count if count is not None else obj.documents.count()

    def validate(self, attrs):
        require_filled(self, attrs, ['truck_model'])
        return attrs

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
        #
        # Only re-match when the plate actually CHANGED. The edit modal
        # always includes plate_number in the PATCH payload, even when only
        # another field is being edited — re-matching on every such PATCH
        # would silently wipe a working GPS link if device_for_plate() no
        # longer resolves the (unchanged) plate.
        new_plate = validated_data.get('plate_number')
        if new_plate is not None and new_plate != instance.plate_number:
            validated_data['traccar_device'] = device_for_plate(new_plate)
        return super().update(instance, validated_data)


class TrailerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Trailer
        fields = ['id', 'plate_number', 'owner_type', 'status', 'is_active']
        read_only_fields = ['id']


class DriverSerializer(serializers.ModelSerializer):
    """Driver registry row.

    `id` is read-only because it is the `Z_TIRWEB.drivers.id` that
    `Shipment.driver_id` points at — reassigning it would silently repoint every
    shipment referencing this driver.

    `logo_ref` / `driver_logo_code` are read-only for a different reason: the
    import owns them (they are refreshed from Z_TIRWEB on every run, so an edit
    here would be silently reverted), and `driver_logo_code` decides which rows
    the duplicate retirement treats as the same person. They are exposed so an
    operator can tell apart two drivers who share a name — ids 30/31 are both
    `BATYROW BAYRAMMYRAT` and only the code separates them.
    """

    class Meta:
        model = Driver
        fields = ['id', 'name', 'phone', 'logo_ref', 'driver_logo_code', 'is_active']
        read_only_fields = ['id', 'logo_ref', 'driver_logo_code']


class DriverAdminSerializer(DriverSerializer):
    """Driver row WITH passport identity, for fleet editors only.

    Kept apart from `DriverSerializer` because the pickers (`DriverSelect`,
    `SheetDriverSelectEditor`, `ShipmentDriverSelector`) read the very same
    `/transport/drivers/` route as the Fleet Admin screen. One serializer for
    both would ship passport serials to every authenticated user.
    `DriverViewSet.get_serializer_class()` chooses between them.

    `document_count` lets the admin table show "has a passport scan" without a
    request per row; the scans themselves come from the documents actions.
    """

    document_count = serializers.SerializerMethodField()

    class Meta(DriverSerializer.Meta):
        fields = DriverSerializer.Meta.fields + [
            'passport_serial', 'passport_issue_date', 'document_count',
        ]

    def validate(self, attrs):
        # Only here, not on `DriverSerializer`: the picker route shares that
        # class and must keep READING drivers for every authenticated user.
        # Writes always resolve to this class (DriverViewSet.get_serializer_class
        # returns it for exactly the roles CanEditFleet admits), so there is no
        # write path around this check.
        require_filled(self, attrs, ['passport_serial', 'passport_issue_date'])
        return attrs

    def get_document_count(self, obj: Driver) -> int:
        # Annotated by the viewset's queryset; the attribute fallback keeps the
        # serializer usable on a plain instance (create/update responses).
        count = getattr(obj, 'document_count_annotated', None)
        return count if count is not None else obj.documents.count()


class DriverDocumentSerializer(serializers.ModelSerializer):
    """Read-only metadata for one passport scan.

    No file URL is exposed — the scan is served only through the authenticated
    `documents/<id>/download` action, never a direct /media/ URL, because nginx
    aliases /media/ with no auth on this deployment.
    """

    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DriverDocument
        fields = [
            'id', 'original_filename', 'mime_type', 'size_bytes',
            'uploaded_by', 'uploaded_by_name', 'uploaded_at',
        ]
        read_only_fields = fields

    def get_uploaded_by_name(self, obj: DriverDocument) -> str:
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.username


class TruckHeadDocumentSerializer(serializers.ModelSerializer):
    """Read-only metadata for one tech passport scan.

    No file URL is exposed — the scan is served only through the authenticated
    `documents/<id>/download` action, never a direct /media/ URL. Same reason as
    `DriverDocumentSerializer`: nginx aliases /media/ with no auth here.
    """

    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TruckHeadDocument
        fields = [
            'id', 'original_filename', 'mime_type', 'size_bytes',
            'uploaded_by', 'uploaded_by_name', 'uploaded_at',
        ]
        read_only_fields = fields

    def get_uploaded_by_name(self, obj: TruckHeadDocument) -> str:
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.username
