from django.db import transaction

from apps.transport.models import Truck, TruckHead, Trailer, Driver
from apps.transport.services.matching import normalize_plate, _pick_device
from apps.transport.services.tir_client import TirClient


def _import_truck_heads(client: TirClient) -> int:
    """Upsert TruckHead rows, binding each to its Traccar device by plate."""
    norm_to_truck = {normalize_plate(t.plate): t for t in Truck.objects.all()}
    rows = client.get_truck_heads()
    for row in rows:
        truck = norm_to_truck.get(normalize_plate(row['plate_number']))
        TruckHead.objects.update_or_create(
            id=row['id'],
            defaults={
                'plate_number': row['plate_number'],
                'owner_type': row.get('owner_type') or '',
                'owner_name': row.get('owner_name') or '',
                'status': row.get('status') or '',
                'capacity': row.get('capacity'),
                'traccar_device': _pick_device(truck) if truck else None,
            },
        )
    return len(rows)


def _import_trailers(client: TirClient) -> int:
    """Upsert Trailer rows."""
    rows = client.get_trailers()
    for row in rows:
        Trailer.objects.update_or_create(
            id=row['id'],
            defaults={
                'plate_number': row['plate_number'],
                'owner_type': row.get('owner_type') or '',
                'status': row.get('status') or '',
            },
        )
    return len(rows)


def _import_drivers(client: TirClient) -> int:
    """Upsert Driver rows.

    `name` is the ONLY field in `defaults`, matching the TruckHead/Trailer
    convention that a re-import must not clobber platform-side edits.
    Deliberately excluded:
      - `phone` — Z_TIRWEB holds no phone for any driver and never will, so
        including it would give a re-run exactly one possible effect: nulling
        whatever an operator typed here.
      - `is_active` — a manual deactivate must survive a re-run, same as heads
        and trailers. All 152 source rows are active, so on create the model
        default already matches the source.
    This import never touches Shipment.driver_name/driver_phone — those stay the
    operator-entered text they are.
    """
    rows = client.get_drivers()
    for row in rows:
        Driver.objects.update_or_create(
            id=row['id'],
            defaults={'name': row['full_name']},
        )
    return len(rows)


@transaction.atomic
def import_fleet(client: TirClient | None = None) -> dict:
    """One-time (idempotent) import of TruckHead/Trailer/Driver from Z_TIRWEB.

    Preserves the source `id` so Shipment.truck_head_id/trailer_id/driver_id stay
    valid — those columns are raw integers pointing into Z_TIRWEB's id space (see
    apps/export/models/shipment.py, "=== Transport ===").
    mssql-django auto-wraps explicit-`id=` inserts in SET IDENTITY_INSERT, so
    plain `update_or_create(id=...)` is sufficient — no manual cursor handling.
    SQL Server also auto-advances the identity counter to the highest value
    ever explicitly inserted via SET IDENTITY_INSERT, so subsequent
    app-created rows already land above the imported max id with no manual
    reseed needed (empirically confirmed — see task-2-report.md).
    """
    client = client or TirClient()
    return {
        'truck_heads': _import_truck_heads(client),
        'trailers': _import_trailers(client),
        'drivers': _import_drivers(client),
    }
