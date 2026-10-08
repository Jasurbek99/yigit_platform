"""Pull Planning trips into ExternalTrip (spec §4).

changedSince is strictly-after and rows come ordered changedAt+id, so paging is
keyset: each next page asks from the last row's changedAt − 1 µs (a row that
changes mid-run cannot shift another off a page-number boundary). The first
request starts at cursor − OVERLAP; the upsert is idempotent, so re-reading a
row is free. One bad row is logged and skipped — it must not stall the cursor.

Reacting to changes is NOT done here: the poller compares every linked trip
with its shipment afterwards (trip_assignment.find_pending_changes), so a
change whose reaction failed is found again on the next tick.
"""
import logging
from datetime import datetime, timedelta

from django.utils import timezone

from apps.transport.models import ExternalTrip, ExternalTripSyncState
from apps.transport.services.trip_parsing import parse_trip
from apps.transport.services.trip_push_ops import REJECTION_OP
from apps.transport.services.trips_client import TripsApiUnavailable, get_trips_client

logger = logging.getLogger(__name__)

OVERLAP = timedelta(minutes=5)
PAGE_SIZE = 200
KEYSET_STEP = timedelta(microseconds=1)


def is_real_change(old: dict, new: dict) -> bool:
    """Only resource swaps or a cancel count; status moves and our own pushes don't."""
    if new['status'] == 'CANCELLED' and old['status'] != 'CANCELLED':
        return True
    return any(old[f] != new[f] for f in ExternalTrip.SNAPSHOT_FIELDS)


def _country_from_detail(client, trip_uuid: str) -> tuple[str | None, bool]:
    """(country code, whether Planning answered)."""
    try:
        return client.get_trip(trip_uuid).get('destinationCountryCode'), True
    except TripsApiUnavailable as exc:
        logger.warning('Planning trip detail %s failed: %s', trip_uuid, exc)
        return None, False


def _upsert(item: dict, client) -> ExternalTrip | None:
    """Write Planning's columns only; return the trip when it is linked and really changed.

    update_fields keeps our own columns (shipment, conflict_note, push state)
    out of the write, so a poll racing an assign cannot undo it.
    """
    fields = parse_trip(item)
    trip = ExternalTrip.objects.filter(integration_trip_id=fields['integration_trip_id']).first()
    if fields['destination_country_code'] is None:
        fields['destination_country_code'] = trip.destination_country_code if trip else None
    # Ask the detail endpoint once per trip version, not on every overlapping poll.
    is_new_version = trip is None or trip.changed_at != fields['changed_at']
    if fields['destination_country_code'] is None and is_new_version:
        code, answered = _country_from_detail(client, item['integrationTripId'])
        fields['destination_country_code'] = code
        if not answered:
            # Store a stamp just older than Planning's so the next poll sees a
            # "new version" and asks again (the cursor uses Planning's own stamp).
            fields['changed_at'] = fields['changed_at'] - KEYSET_STEP
    if trip is None:
        ExternalTrip.objects.create(**fields)
        return None
    old = {f: getattr(trip, f) for f in (*ExternalTrip.SNAPSHOT_FIELDS, 'status')}
    for name, value in fields.items():
        setattr(trip, name, value)
    trip.save(update_fields=[*fields, 'synced_at'])
    changed = is_real_change(old, fields)
    if changed:
        # Planning swapped the truck or driver (or cancelled): our rejection is answered.
        # Filtered queryset updates, not the copy read above: a reject may have
        # committed since, and our columns stay out of the poll's own save.
        answered = ExternalTrip.objects.filter(pk=trip.pk, rejected_at__isnull=False)
        answered.update(**dict.fromkeys(ExternalTrip.REJECTION_FIELDS))
        ExternalTrip.objects.filter(pk=trip.pk, last_push_error__startswith=f'{REJECTION_OP}:').update(
            last_push_status=None, last_push_error=None)
    return trip if trip.shipment_id and changed else None


def _sync_page(items: list[dict], client, changed: list, errors: list) -> datetime | None:
    newest = None
    for item in items:
        try:
            trip = _upsert(item, client)
            stamp = parse_trip(item)['changed_at']
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning('Skipping malformed Planning trip %s: %r', item.get('integrationTripId'), exc)
            errors.append(f"{item.get('integrationTripId')}: {exc!r}")
            continue
        if trip:
            changed.append(trip)
        newest = stamp if newest is None or stamp > newest else newest
    return newest


def _pull_pages(client, since: datetime | None, changed: list, errors: list) -> datetime | None:
    """Read every page (keyset on changedAt); return the newest changedAt seen."""
    newest = None
    page = 1
    while True:
        items = client.list_trips(since, page=page, page_size=PAGE_SIZE).get('items') or []
        page_newest = _sync_page(items, client, changed, errors)
        if page_newest and (newest is None or page_newest > newest):
            newest = page_newest
        if len(items) < PAGE_SIZE:
            return newest
        next_since = page_newest - KEYSET_STEP if page_newest else None
        # A full page sharing one timestamp cannot move the keyset forward.
        if next_since is not None and (since is None or next_since > since):
            since, page = next_since, 1
        else:
            page += 1


def sync_external_trips(client=None) -> list[ExternalTrip]:
    """One poll: upsert changed trips, advance the cursor; raises TripsApiUnavailable on outage."""
    client = client or get_trips_client()
    state = ExternalTripSyncState.load()
    changed: list[ExternalTrip] = []
    errors: list[str] = []
    try:
        newest = _pull_pages(client, state.cursor - OVERLAP if state.cursor else None, changed, errors)
    except TripsApiUnavailable as exc:
        state.last_error = str(exc)[:2000]
        state.save(update_fields=['last_error'])
        raise
    if newest and (state.cursor is None or newest > state.cursor):
        state.cursor = newest
    state.last_success_at = timezone.now()
    state.last_error = '; '.join(errors)[:2000]
    state.save()
    return changed
