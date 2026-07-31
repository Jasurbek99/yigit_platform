import logging
import re

from django.utils.dateparse import parse_datetime

from apps.transport.models import Truck, TraccarDevice, DevicePosition
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
    """Upsert Truck + TraccarDevice rows from Traccar. Returns device count."""
    client = client or TraccarClient()
    devices = client.get_devices()
    for device in devices:
        plate, fleet_no = parse_device_name(device.get('name', ''))
        truck, _ = Truck.objects.update_or_create(
            plate=plate,
            defaults={'fleet_no': fleet_no, 'category': device.get('category') or 'unknown'},
        )
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
    return len(devices)


def sync_positions(client: TraccarClient | None = None) -> int:
    """Upsert the latest DevicePosition per known device. Returns rows written."""
    client = client or TraccarClient()
    positions = client.get_positions()
    device_ids = {p['deviceId'] for p in positions}
    known = {
        d.traccar_id: d
        for d in TraccarDevice.objects.filter(traccar_id__in=device_ids)
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
        attrs = pos.get('attributes') or {}
        DevicePosition.objects.update_or_create(
            device=device,
            defaults={
                'latitude': pos['latitude'],
                'longitude': pos['longitude'],
                'speed': pos.get('speed'),
                'course': pos.get('course'),
                'address': (pos.get('address') or '')[:300] or None,
                'ignition': attrs.get('ignition'),
                'fix_time': parse_datetime(pos['fixTime']) if pos.get('fixTime') else None,
                'valid': pos.get('valid', True),
            },
        )
        written += 1
    return written
