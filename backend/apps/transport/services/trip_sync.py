"""Pull Planning trips into ExternalTrip (spec §4).

changedSince is strictly-after and pages are ordered changedAt+id, so we poll
from cursor − OVERLAP: the upsert is idempotent, the overlap guards against
rows sharing a timestamp across polls.
"""
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.transport.models import ExternalTrip, ExternalTripSyncState
from apps.transport.services.trip_parsing import parse_trip
from apps.transport.services.trips_client import TripsApiUnavailable, get_trips_client

logger = logging.getLogger(__name__)

OVERLAP = timedelta(minutes=5)
PAGE_SIZE = 200


def is_real_change(old: dict, new: dict) -> bool:
    """Only resource swaps or a cancel count; status moves and our own pushes don't."""
    if new['status'] == 'CANCELLED' and old['status'] != 'CANCELLED':
        return True
    return any(old[f] != new[f] for f in ExternalTrip.SNAPSHOT_FIELDS)


def _upsert(item: dict, client) -> ExternalTrip | None:
    """Write one trip; return it when it is linked and really changed."""
    fields = parse_trip(item)
    trip = ExternalTrip.objects.filter(integration_trip_id=fields['integration_trip_id']).first()
    if fields['destination_country_code'] is None:
        fields['destination_country_code'] = trip.destination_country_code if trip else None
    if fields['destination_country_code'] is None:
        fields['destination_country_code'] = client.get_trip(item['integrationTripId']).get('destinationCountryCode')
    if trip is None:
        ExternalTrip.objects.create(**fields)
        return None
    old = {f: getattr(trip, f) for f in (*ExternalTrip.SNAPSHOT_FIELDS, 'status')}
    for name, value in fields.items():
        setattr(trip, name, value)
    trip.save()
    return trip if trip.shipment_id and is_real_change(old, fields) else None


def sync_external_trips(client=None) -> list[ExternalTrip]:
    client = client or get_trips_client()
    state = ExternalTripSyncState.load()
    since = state.cursor - OVERLAP if state.cursor else None
    changed: list[ExternalTrip] = []
    newest = state.cursor
    page = 1
    try:
        while True:
            data = client.list_trips(since, page=page, page_size=PAGE_SIZE)
            items = data.get('items') or []
            with transaction.atomic():
                for item in items:
                    trip = _upsert(item, client)
                    if trip:
                        changed.append(trip)
            for item in items:
                stamp = parse_trip(item)['changed_at']
                newest = stamp if newest is None or stamp > newest else newest
            if not items or page * PAGE_SIZE >= data.get('total', 0):
                break
            page += 1
    except TripsApiUnavailable as exc:
        state.last_error = str(exc)[:2000]
        state.save(update_fields=['last_error'])
        raise
    state.cursor = newest
    state.last_success_at = timezone.now()
    state.last_error = ''
    state.save()
    return changed
