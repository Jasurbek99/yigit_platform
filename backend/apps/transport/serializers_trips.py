from rest_framework import serializers

from apps.transport.models import ExternalTrip
from apps.transport.services.trip_parsing import has_unrecognised_visa, visa_country_codes


class ExternalTripSerializer(serializers.ModelSerializer):
    visas = serializers.SerializerMethodField()
    visa_country_codes = serializers.SerializerMethodField()
    has_unrecognised_visa = serializers.SerializerMethodField()
    shipment_code = serializers.CharField(source='shipment.shipment_code', read_only=True, default=None)
    position = serializers.SerializerMethodField()

    class Meta:
        model = ExternalTrip
        fields = [
            'id', 'integration_trip_id', 'trip_number', 'status', 'planned_departure', 'changed_at',
            'destination_country_code',
            'tractor_plate', 'tractor_brand', 'tractor_model', 'tractor_company', 'tractor_source',
            'trailer_plate', 'trailer_brand', 'trailer_model', 'trailer_company', 'trailer_source',
            'driver_full_name', 'driver_phone', 'driver_passport_number', 'driver_passport_expiry',
            'driver_source', 'visas', 'visa_country_codes', 'has_unrecognised_visa',
            'shipment', 'shipment_code', 'conflict_note', 'last_push_status', 'last_push_error', 'position',
        ]

    def get_visas(self, trip) -> list[dict]:
        pairs = [c.rsplit(':', 1) for c in filter(None, trip.driver_visas.split(';'))]
        return [{'country': name, 'expiry_date': expiry} for name, expiry in pairs]

    def get_visa_country_codes(self, trip) -> list[str]:
        return visa_country_codes(trip.driver_visas)

    def get_has_unrecognised_visa(self, trip) -> bool:
        return has_unrecognised_visa(trip.driver_visas)

    def get_position(self, trip) -> dict | None:
        position = self.context.get('positions', {}).get(trip.tractor_plate)
        if position is None:
            return None
        return {
            'lat': float(position.latitude), 'lon': float(position.longitude),
            'address': position.address, 'fix_time': position.fix_time,
            'geofence_name': getattr(position.current_geofence, 'name', None),
        }


class CandidateShipmentSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    shipment_code = serializers.CharField()
    date = serializers.DateField()
    country_code = serializers.CharField(source='country.code', default=None)
    country_name = serializers.CharField(source='country.name_tk', default=None)
    customer = serializers.IntegerField(source='customer_id', allow_null=True)
    customer_name = serializers.CharField(source='customer.name', default=None)
    blocks = serializers.SerializerMethodField()

    def get_blocks(self, shipment) -> list[str]:
        return [s.block.code for s in shipment.block_sources.all()]
