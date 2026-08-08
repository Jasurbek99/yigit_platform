import re

from apps.transport.models import Truck, TraccarDevice, DevicePosition, ShipmentDeviceLink

_NON_ALNUM = re.compile(r'[^A-Z0-9]')
_SPLIT = re.compile(r'[/\s]')
_CYRILLIC = re.compile(r'[А-Яа-яЁёІіЇїЄєҐґ]')


def normalize_plate(value: str) -> str:
    """Uppercase and strip everything but letters/digits."""
    return _NON_ALNUM.sub('', (value or '').upper())


def _tractor_token(truck_plate: str) -> str:
    """The tractor plate = first token before a '/' or whitespace."""
    return _SPLIT.split((truck_plate or '').strip(), maxsplit=1)[0]


def _pick_device(truck: Truck) -> TraccarDevice | None:
    """Prefer a device with a stored position, then category 'truck', then any."""
    devices = list(TraccarDevice.objects.filter(truck=truck))
    if not devices:
        return None
    positioned = set(
        DevicePosition.objects.filter(device_id__in=[d.id for d in devices])
        .values_list('device_id', flat=True)
    )
    for d in devices:
        if d.id in positioned:
            return d
    for d in devices:
        if d.category == 'truck':
            return d
    return devices[0]


def resolve_device_for_shipment(shipment) -> tuple[TraccarDevice | None, str]:
    """Resolve the shipment's Traccar device.

    Order: a manual ShipmentDeviceLink (authoritative operator override), then
    an explicit truck_head_id, then a plate auto-match, else none.
    Returns (device_or_None, 'manual'|'auto'|'none').
    """
    # 1. Manual override (authoritative — always wins, even over truck_head_id).
    link = (
        ShipmentDeviceLink.objects.filter(shipment=shipment)
        .select_related('device').first()
    )
    if link:
        return link.device, 'manual'

    # 2. Explicit truck-head selection.
    if getattr(shipment, 'truck_head_id', None):
        from apps.transport.models import TruckHead
        th = (
            TruckHead.objects.filter(id=shipment.truck_head_id)
            .select_related('traccar_device').first()
        )
        if th and th.traccar_device_id:
            return th.traccar_device, 'auto'
        # truck-head set but no device → do NOT fall through to plate-match
        # (an explicit selection with no GPS device means "no GPS", not "guess").
        return None, 'none'

    token = _tractor_token(shipment.truck_plate)
    if _CYRILLIC.search(token):
        # normalize_plate() strips Cyrillic letters, which can shrink a homoglyph
        # plate (e.g. a Cyrillic 'А' in '4378АHF') into a token that collides with
        # a DIFFERENT Latin Truck.plate. The fleet's plates are all Latin, so a
        # Cyrillic-containing shipment plate cannot be reliably matched — bail out.
        return None, 'none'

    plate_norm = normalize_plate(token)
    if not plate_norm:
        return None, 'none'

    norm_to_truck = {
        normalize_plate(plate): tid
        for tid, plate in Truck.objects.filter(is_active=True).values_list('id', 'plate')
    }
    truck_id = norm_to_truck.get(plate_norm)
    if truck_id is None:
        return None, 'none'
    device = _pick_device(Truck.objects.get(id=truck_id))
    return (device, 'auto') if device else (None, 'none')


def device_for_plate(plate: str) -> "TraccarDevice | None":
    """Best Traccar device for a plate (same choice the resolver would make).

    Looks up the active Truck by normalized plate, then _pick_device().
    """
    plate_norm = normalize_plate(plate)
    if not plate_norm:
        return None
    norm_to_truck = {
        normalize_plate(p): tid
        for tid, p in Truck.objects.filter(is_active=True).values_list('id', 'plate')
    }
    truck_id = norm_to_truck.get(plate_norm)
    if truck_id is None:
        return None
    return _pick_device(Truck.objects.get(id=truck_id))
