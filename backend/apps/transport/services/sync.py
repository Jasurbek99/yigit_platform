import logging
import re
from datetime import datetime

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.transport.models import Truck, TraccarDevice, TraccarGeofence, DevicePosition
from apps.transport.services.traccar_client import TraccarClient

logger = logging.getLogger(__name__)

_FLEET_RE = re.compile(r'^(?P<plate>.+?)\s+(?P<fleet>TR\d+)$', re.IGNORECASE)


def parse_device_name(name: str) -> tuple[str, str | None]:
    """Split a Traccar device name '<PLATE> TR<NN>' into (plate, fleet_no).

    Returns (whole_name, None) when there is no trailing TR## token.
    """
    cleaned = (name or '').strip()
    match = _FLEET_RE.match(cleaned)
    if match:
        return match.group('plate').strip(), match.group('fleet').upper()
    return cleaned, None


def sync_devices(client: TraccarClient | None = None) -> int:
    """Upsert Truck + TraccarDevice rows from Traccar. Returns devices synced."""
    client = client or TraccarClient()
    synced = 0
    for device in client.get_devices():
        try:
            with transaction.atomic():
                _sync_device(device)
        except Exception:
            # One bad device must not stop every other truck from updating.
            logger.exception('Skipping Traccar device id=%s name=%r', device.get('id'), device.get('name'))
            continue
        synced += 1
    return synced


def _sync_device(device: dict) -> None:
    plate, fleet_no = parse_device_name(device.get('name', ''))
    truck_fields = {'fleet_no': fleet_no, 'category': device.get('category') or 'unknown'}
    # A known device keeps its truck even when renamed in Traccar; matching by
    # plate alone would insert a second row with the same unique fleet_no.
    known = TraccarDevice.objects.filter(traccar_id=device['id']).select_related('truck').first()
    if known and known.truck:
        truck = known.truck
        Truck.objects.filter(pk=truck.pk).update(plate=plate, **truck_fields)
    else:
        truck, _ = Truck.objects.update_or_create(plate=plate, defaults=truck_fields)
    TraccarDevice.objects.update_or_create(
        traccar_id=device['id'],
        defaults={
            'imei': device.get('uniqueId'),
            'name': device.get('name', ''),
            'category': device.get('category'),
            'truck': truck,
            'status': device.get('status', 'unknown'),
            'last_seen': parse_datetime(device['lastUpdate']) if device.get('lastUpdate') else None,
        },
    )


def sync_positions(client: TraccarClient | None = None) -> int:
    """Upsert the latest DevicePosition per known device. Returns rows written."""
    client = client or TraccarClient()
    positions = client.get_positions()
    device_ids = {p['deviceId'] for p in positions}
    known = {
        d.traccar_id: d
        for d in TraccarDevice.objects.filter(traccar_id__in=device_ids)
    }
    geofences = {g.traccar_id: g for g in TraccarGeofence.objects.all()}
    previous = {
        device_id: (geofence_id, since)
        for device_id, geofence_id, since in DevicePosition.objects.values_list(
            'device_id', 'current_geofence_id', 'geofence_since',
        )
    }
    written = 0
    for pos in positions:
        device = known.get(pos['deviceId'])
        if device is None:
            logger.warning(
                'Skipping position for unknown deviceId=%s (no TraccarDevice row)',
                pos.get('deviceId'),
            )
            continue
        if pos.get('latitude') is None:
            logger.warning(
                'Skipping position for deviceId=%s: missing latitude',
                pos.get('deviceId'),
            )
            continue
        try:
            with transaction.atomic():
                _write_position(pos, device, geofences, previous.get(device.pk))
        except Exception:
            logger.exception('Skipping position for deviceId=%s', pos.get('deviceId'))
            continue
        written += 1
    return written


def _write_position(
    pos: dict,
    device: TraccarDevice,
    geofences: dict[int, TraccarGeofence],
    previous: tuple[int | None, datetime | None] | None,
) -> None:
    attrs = pos.get('attributes') or {}
    raw_speed = pos.get('speed')
    speed_kmh = round(raw_speed * 1.852, 2) if raw_speed is not None else None
    fix_time = parse_datetime(pos['fixTime']) if pos.get('fixTime') else None
    geofence = _current_geofence(pos, geofences)
    DevicePosition.objects.update_or_create(
        device=device,
        defaults={
            'latitude': pos['latitude'],
            'longitude': pos['longitude'],
            'speed': speed_kmh,
            'course': pos.get('course'),
            'address': (pos.get('address') or '')[:300] or None,
            'ignition': attrs.get('ignition'),
            'fix_time': fix_time,
            'valid': pos.get('valid', True),
            'current_geofence': geofence,
            'geofence_since': _geofence_since(geofence, fix_time, previous),
        },
    )


def sync_geofences(client: TraccarClient | None = None) -> int:
    """Upsert TraccarGeofence rows (id + name) from Traccar. Returns geofence count."""
    client = client or TraccarClient()
    geofences = client.get_geofences()
    for geofence in geofences:
        TraccarGeofence.objects.update_or_create(
            traccar_id=geofence['id'], defaults={'name': geofence.get('name') or ''},
        )
    return len(geofences)


def _current_geofence(
    pos: dict, geofences: dict[int, TraccarGeofence],
) -> TraccarGeofence | None:
    """The geofence Traccar says this position is in (None if none, or not synced yet)."""
    ids = pos.get('geofenceIds') or []
    if len(ids) > 1:
        # Our 31 polygons don't overlap today; if someone draws one that does,
        # say so rather than silently picking.
        logger.warning(
            'deviceId=%s is inside %d geofences %s; using the first',
            pos.get('deviceId'), len(ids), ids,
        )
    return geofences.get(ids[0]) if ids else None


def _geofence_since(
    geofence: TraccarGeofence | None,
    fix_time: datetime | None,
    previous: tuple[int | None, datetime | None] | None,
) -> datetime | None:
    """Keep the stored timestamp while the geofence is unchanged, else start from this fix."""
    if geofence is None:
        return None
    if previous and previous[0] == geofence.pk and previous[1]:
        return previous[1]
    return fix_time or timezone.now()
