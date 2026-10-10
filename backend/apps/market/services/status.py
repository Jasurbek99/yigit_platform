"""Moving the shipment's status from the bazaar journal (spec §5).

AD-1 is retired (docs/ADR.md ADR-010, 2026-05 amendment): arrived_at,
sale_started_at and city are operator-entered fields, so a service may write
them. The status itself is never set here — the plain Shipment.save() resolves
the step tasks and auto-advance moves it through transition_to().
"""
import logging

from django.db import transaction
from django.utils import timezone

from apps.core.models import User
from apps.core.seasons import SeasonClosedError, assert_season_open
from apps.export.models import AuditLog, Shipment
from apps.export.services.sheet_audit import diff_audit_rows, snapshot_fields
from apps.market.models import Lot
from apps.market.scoping import member_of

logger = logging.getLogger(__name__)

DRIVEN_FIELDS = ['arrived_at', 'sale_started_at', 'city']
# Steps where a sale proves the truck has arrived (the arrival task gates them).
BEFORE_ARRIVAL = ('barysh_gumrugi', 'transshipment')


def drive_first_sale(lot_id: int, user: User) -> bool:
    """Fill the shipment's arrival / sale-start / city after the lot's first sale.

    Runs from `transaction.on_commit` in services.entries.create_sale, so the
    sale is already saved: any failure here is logged and swallowed. Only
    fields still empty are filled, so a re-run (e.g. a first sale again after
    every sale was deleted) changes nothing. Returns whether the shipment was saved.
    """
    try:
        with transaction.atomic():
            return _drive(lot_id, user)
    except Exception:
        logger.exception('market: first sale on lot %s did not update the shipment', lot_id)
        return False


def _drive(lot_id: int, user: User) -> bool:
    lot = Lot.objects.get(pk=lot_id)
    shipment = (Shipment.objects.select_for_update().select_related('status', 'season')
                .get(pk=lot.shipment_id))
    try:
        assert_season_open(shipment.season)
    except SeasonClosedError:
        return False
    before = snapshot_fields(shipment, DRIVEN_FIELDS)
    now = timezone.now()
    if shipment.status.code in BEFORE_ARRIVAL and shipment.arrived_at is None:
        shipment.arrived_at = now
    if shipment.sale_started_at is None:
        shipment.sale_started_at = now
    if shipment.city_id is None:
        member = member_of(user)
        bazaar = member.bazaar if member is not None else None
        if bazaar is not None and bazaar.city_id is not None:
            shipment.city_id = bazaar.city_id
    if snapshot_fields(shipment, DRIVEN_FIELDS) == before:
        return False
    shipment.updated_by = user
    try:
        shipment.save()
    except SeasonClosedError:
        return False
    rows = diff_audit_rows(shipment, before, snapshot_fields(shipment, DRIVEN_FIELDS), user)
    AuditLog.objects.bulk_create(rows, batch_size=500)
    return True
