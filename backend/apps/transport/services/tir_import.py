from django.db import transaction

from apps.transport.models import Truck, TruckHead, Trailer
from apps.transport.services.matching import normalize_plate, _pick_device
from apps.transport.services.tir_client import TirClient


@transaction.atomic
def import_fleet(client: TirClient | None = None) -> dict:
    """One-time (idempotent) import of TruckHead/Trailer from Z_TIRWEB.

    Preserves the source `id` so Shipment.truck_head_id/trailer_id stay valid.
    mssql-django auto-wraps explicit-`id=` inserts in SET IDENTITY_INSERT, so
    plain `update_or_create(id=...)` is sufficient — no manual cursor handling.
    SQL Server also auto-advances the identity counter to the highest value
    ever explicitly inserted via SET IDENTITY_INSERT, so subsequent
    app-created rows already land above the imported max id with no manual
    reseed needed (empirically confirmed — see task-2-report.md).
    """
    client = client or TirClient()
    norm_to_truck = {normalize_plate(t.plate): t for t in Truck.objects.all()}

    heads = client.get_truck_heads()
    for row in heads:
        truck = norm_to_truck.get(normalize_plate(row['plate_number']))
        dev = _pick_device(truck) if truck else None
        TruckHead.objects.update_or_create(
            id=row['id'],
            defaults={
                'plate_number': row['plate_number'],
                'owner_type': row.get('owner_type') or '',
                'owner_name': row.get('owner_name') or '',
                'status': row.get('status') or '',
                'capacity': row.get('capacity'),
                'traccar_device': dev,
            },
        )

    trailers = client.get_trailers()
    for row in trailers:
        Trailer.objects.update_or_create(
            id=row['id'],
            defaults={
                'plate_number': row['plate_number'],
                'owner_type': row.get('owner_type') or '',
                'status': row.get('status') or '',
            },
        )

    return {'truck_heads': len(heads), 'trailers': len(trailers)}
