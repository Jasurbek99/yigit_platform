from rest_framework import serializers

from apps.transport.models import ExternalTrip
from apps.transport.services.trip_parsing import (
    country_codes_by_name, has_unrecognised_visa, visa_country_codes, visa_entries,
)


class ExternalTripSerializer(serializers.ModelSerializer):
    """A Planning trip with its link, conflict and live position (Truck Board card/drawer)."""

    visas = serializers.SerializerMethodField()
    visa_country_codes = serializers.SerializerMethodField()
    has_unrecognised_visa = serializers.SerializerMethodField()
    shipment_code = serializers.CharField(source='shipment.shipment_code', read_only=True, default=None)
    # Truck-change rollback mark of the linked shipment (export services/rollback.py).
    shipment_documents_reset_at = serializers.DateTimeField(
        source='shipment.documents_reset_at', read_only=True, default=None,
    )
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
            'shipment', 'shipment_code', 'shipment_documents_reset_at', 'conflict_note', 'conflict_kind', 'conflict_from', 'conflict_to',
            'last_push_status', 'last_push_error', 'position',
        ]

    def _country_map(self) -> dict[str, str]:
        # One Country query per response, not per trip.
        if '_country_map' not in self.context:
            self.context['_country_map'] = country_codes_by_name()
        return self.context['_country_map']

    def get_visas(self, trip: ExternalTrip) -> list[dict]:
        return [{'country': name, 'expiry_date': expiry} for name, expiry in visa_entries(trip.driver_visas)]

    def get_visa_country_codes(self, trip: ExternalTrip) -> list[str]:
        return visa_country_codes(trip.driver_visas, self._country_map())

    def get_has_unrecognised_visa(self, trip: ExternalTrip) -> bool:
        return has_unrecognised_visa(trip.driver_visas, self._country_map())

    def get_position(self, trip: ExternalTrip) -> dict | None:
        position = self.context.get('positions', {}).get(trip.tractor_plate)
        if position is None:
            return None
        return {
            'lat': float(position.latitude), 'lon': float(position.longitude),
            'address': position.address, 'fix_time': position.fix_time,
            'geofence_name': getattr(position.current_geofence, 'name', None),
        }


class CandidateShipmentSerializer(serializers.Serializer):
    """A Preparation shipment still waiting for a truck (Truck Board left column)."""

    id = serializers.IntegerField()
    shipment_code = serializers.CharField()
    date = serializers.DateField()
    country_code = serializers.CharField(source='country.code', default=None)
    country_name = serializers.CharField(source='country.name_tk', default=None)
    customer = serializers.IntegerField(source='customer_id', allow_null=True)
    customer_name = serializers.CharField(source='customer.name', default=None)
    blocks = serializers.SerializerMethodField()
    export_code = serializers.CharField(allow_null=True)
    documents_status = serializers.CharField(allow_null=True)
    import_firm = serializers.IntegerField(source='import_firm_id', allow_null=True)
    import_firm_name = serializers.CharField(source='import_firm.name_company', default=None)
    loading_location = serializers.IntegerField(source='loading_location_id', allow_null=True)
    loading_location_name = serializers.CharField(source='loading_location.name', default=None)
    city = serializers.IntegerField(source='city_id', allow_null=True)
    city_name = serializers.CharField(source='city.name', default=None)
    export_firms = serializers.SerializerMethodField()

    def get_export_firms(self, shipment) -> list[dict]:
        return [
            {'id': split.export_firm_id, 'name': split.export_firm.name_short or split.export_firm.name_tk}
            for split in shipment.firm_splits.all()
        ]

    def get_blocks(self, shipment) -> list[str]:
        return [s.block.code for s in shipment.block_sources.all()]
