import re
from collections import defaultdict
from datetime import timedelta

from django.utils import timezone

from apps.export.models import Shipment
from apps.transport.models import (
    DevicePosition, ShipmentDeviceLink, TraccarDevice, Truck, TruckHead,
)

_NON_ALNUM = re.compile(r'[^A-Z0-9]')
_SPLIT = re.compile(r'[/\s]')
_CYRILLIC = re.compile(r'[А-Яа-яЁёІіЇїЄєҐґ]')

# How far back a still-open shipment counts as the load a truck is carrying on
# the Fleet Map. Statuses are advanced by hand and many stall — on 2026-10-01,
# 30 of the 31 open shipments that resolved to a GPS device were June rows still
# reading «Yola çykdy» while their trucks sat in the garage. Owner's pick (30 days).
CURRENT_LOAD_DAYS = 30


def normalize_plate(value: str) -> str:
    """Uppercase and strip everything but letters/digits."""
    return _NON_ALNUM.sub('', (value or '').upper())


def _tractor_token(truck_plate: str) -> str:
    """The tractor plate = first token before a '/' or whitespace."""
    return _SPLIT.split((truck_plate or '').strip(), maxsplit=1)[0]


def _plate_key(plate: str) -> str:
    """Normalized tractor token of a plate string, '' when it cannot be matched.

    Rejects a Cyrillic-containing token BEFORE normalizing — normalize_plate()
    strips Cyrillic letters, which can shrink a homoglyph plate (e.g. a Cyrillic
    'А' in '4378АHF') into a token that collides with a DIFFERENT Latin
    Truck.plate. The fleet's plates are all Latin, so such a plate cannot be
    reliably matched.
    """
    token = _tractor_token(plate)
    if _CYRILLIC.search(token):
        return ''
    return normalize_plate(token)


def _active_truck_ids_by_plate() -> dict[str, int]:
    return {
        normalize_plate(p): tid
        for tid, p in Truck.objects.filter(is_active=True).values_list('id', 'plate')
    }


def _devices_for_trucks(truck_ids) -> dict[int, TraccarDevice]:
    """Truck id -> its best device: one with a stored position, then category
    'truck', then any. Trucks with no device are absent."""
    by_truck = defaultdict(list)
    for device in TraccarDevice.objects.filter(truck_id__in=truck_ids):
        by_truck[device.truck_id].append(device)
    positioned = set(
        DevicePosition.objects.filter(
            device_id__in=[d.id for devices in by_truck.values() for d in devices],
        ).values_list('device_id', flat=True)
    )
    picked = {}
    for truck_id, devices in by_truck.items():
        picked[truck_id] = (
            next((d for d in devices if d.id in positioned), None)
            or next((d for d in devices if d.category == 'truck'), None)
            or devices[0]
        )
    return picked


def _pick_device(truck: Truck) -> TraccarDevice | None:
    return _devices_for_trucks([truck.id]).get(truck.id)


def device_for_plate(plate: str) -> "TraccarDevice | None":
    """Best Traccar device for a plate string (single source of truth).

    Takes the tractor token (a plate may carry a trailing '/trailer' token),
    looks up the active Truck by normalized plate, then picks its device.
    """
    key = _plate_key(plate)
    if not key:
        return None
    truck_id = _active_truck_ids_by_plate().get(key)
    if truck_id is None:
        return None
    return _devices_for_trucks([truck_id]).get(truck_id)


def resolve_devices_for_shipments(shipments) -> dict[int, tuple[TraccarDevice | None, str]]:
    """Resolve each shipment's Traccar device: shipment pk -> (device_or_None, how).

    Order: a manual ShipmentDeviceLink (authoritative operator override), then
    an explicit truck_head_id, then a plate auto-match, else none. `how` is
    'manual'|'auto'|'none'. A fixed number of queries however many shipments
    are passed — the Fleet Map resolves every open shipment on each 30 s poll.
    """
    shipments = list(shipments)
    manual = {
        link.shipment_id: link.device
        for link in ShipmentDeviceLink.objects.filter(
            shipment_id__in=[s.pk for s in shipments],
        ).select_related('device')
    }
    rest = [s for s in shipments if s.pk not in manual]
    head_devices = {
        th.id: th.traccar_device
        for th in TruckHead.objects.filter(
            id__in={s.truck_head_id for s in rest if s.truck_head_id},
        ).select_related('traccar_device')
    }
    plate_keys = {s.pk: _plate_key(s.truck_plate) for s in rest if not s.truck_head_id}
    plate_truck = {}
    if any(plate_keys.values()):
        truck_ids = _active_truck_ids_by_plate()
        plate_truck = {pk: truck_ids.get(key) for pk, key in plate_keys.items() if key}
    truck_devices = _devices_for_trucks({tid for tid in plate_truck.values() if tid})

    resolved = {}
    for s in shipments:
        if s.pk in manual:
            resolved[s.pk] = (manual[s.pk], 'manual')
            continue
        if s.truck_head_id:
            # truck-head set but no device → do NOT fall through to plate-match
            # (an explicit selection with no GPS device means "no GPS", not "guess").
            device = head_devices.get(s.truck_head_id)
        else:
            device = truck_devices.get(plate_truck.get(s.pk))
        resolved[s.pk] = (device, 'auto') if device else (None, 'none')
    return resolved


def resolve_device_for_shipment(shipment) -> tuple[TraccarDevice | None, str]:
    """Resolve one shipment's Traccar device — see resolve_devices_for_shipments."""
    return resolve_devices_for_shipments([shipment])[shipment.pk]


def current_shipment_by_device() -> dict[int, Shipment]:
    """TraccarDevice pk -> the shipment that truck carries now, for the Fleet Map.

    Candidates are shipments dated within CURRENT_LOAD_DAYS and not complete or
    cancelled. A loaded shipment (any status past «Подготовка») beats a planned
    one, so a plan shows only on a truck with no load; otherwise the newest wins.
    """
    shipments = list(
        Shipment.objects
        .filter(date__gte=timezone.localdate() - timedelta(days=CURRENT_LOAD_DAYS))
        .exclude(status__phase__in=['COMPLETE', 'CANCELLED'])
        .select_related('status', 'country', 'import_firm')
        .prefetch_related('firm_splits__export_firm')
        .order_by('-date', '-id')
    )
    resolved = resolve_devices_for_shipments(shipments)
    by_device = {}
    for shipment in shipments:  # newest first, so the first of each class wins
        device, _ = resolved[shipment.pk]
        if device is None:
            continue
        current = by_device.get(device.pk)
        if current is None or (
            current.status.phase == 'DRAFT' and shipment.status.phase != 'DRAFT'
        ):
            by_device[device.pk] = shipment
    return by_device
