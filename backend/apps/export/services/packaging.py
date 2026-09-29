"""Packing part (план поставки / Üpjünçilik bölegi): where it may move, and how.

Spec: docs/superpowers/specs/2026-09-29-packaging-join-board-design.md

The packing part is PACKING_FIELDS plus the shipment's block_sources and
varieties_dominant. It always lives on the Shipment row that currently carries
it; join / unjoin / swap move it between rows. Nothing in this module changes a
status — transition_to() stays the only path for that.
"""
from decimal import Decimal

from django.db import transaction

from apps.export.models import Notification, Shipment, ShipmentBlockSource, ShipmentStatusLog

# Statuses in which packing may still be joined, detached or swapped.
PRE_LOADING = frozenset({'draft', 'gumruk_girish', 'gumruk_chykysh'})

PACKING_NOT_JOINED = (
    'Packing not joined: join a supply plan to this shipment before loading starts.'
)

# Scalar packing fields that move together with block_sources and
# varieties_dominant. variety is written through its _id column.
PACKING_FIELDS = (
    'export_code', 'variety_id', 'harvest_date', 'harvest_status', 'weight_to_load_kg',
)


def has_packing(shipment: Shipment) -> bool:
    """True when the shipment carries at least one block source."""
    return shipment.block_sources.exists()


def needs_packing_for_loading(shipment: Shipment) -> bool:
    """True when loading cannot be recorded yet: pre-loading row, no packing.

    Rows at yuklenme or later are never checked — legacy Excel imports may have
    no block_sources at all, and editing their loading time must keep working.
    """
    code = shipment.status.code if shipment.status_id else None
    return code in PRE_LOADING and not has_packing(shipment)


def packaging_weight(shipment: Shipment) -> Decimal | None:
    """Weight of the packing on ``shipment``, read BEFORE it moves.

    All blocks weighed → their sum. Otherwise, on a draft, the row's own
    weight_net (a supply-first plan keeps its total there while its blocks
    carry no kg). Otherwise the sum of the weighed blocks, or None.
    """
    weights = list(shipment.block_sources.values_list('weight_kg', flat=True))
    if not weights:
        return None
    weighed = [w for w in weights if w is not None]
    if len(weighed) == len(weights):
        return sum(weighed, Decimal('0'))
    if shipment.status.code == 'draft' and shipment.weight_net is not None:
        return shipment.weight_net
    return sum(weighed, Decimal('0')) if weighed else None


def net_update(shipment: Shipment, incoming: Decimal | None) -> dict:
    """weight_net change for a row that just received ``incoming`` packing weight.

    Draft: the net follows the packing. After documents start: only an empty
    net is filled — documents read weight from the PackingTemplate, and the
    pallet manifest overwrites weight_net at loading anyway. weight_gross is
    never touched.
    """
    if shipment.status.code == 'draft':
        return {'weight_net': incoming}
    if shipment.weight_net is None and incoming is not None:
        return {'weight_net': incoming}
    return {}


def assert_can_move_packing(shipment: Shipment) -> None:
    """Raise ValueError unless packing on ``shipment`` may still change."""
    if shipment.status.code not in PRE_LOADING:
        raise ValueError(
            f'{shipment.shipment_code}: loading has started — packing can no longer change'
        )
    if shipment.pallets.exists():
        raise ValueError(
            f'{shipment.shipment_code}: pallets are recorded — packing can no longer change'
        )


def _notify_packing_change(shipments: list[Shipment], user, message: str) -> None:
    """Tell the loading department (and document_team once documents started)."""
    from apps.core.models import User

    roles = {'loading_dept_head'}
    if any(s.status.code != 'draft' for s in shipments):
        roles.add('document_team')
    user_ids = (
        User.objects.filter(role__in=roles, is_active=True)
        .exclude(pk=user.pk)
        .values_list('id', flat=True)
    )
    link = f'/export/shipments/sheet?shipment={shipments[0].pk}'
    Notification.objects.bulk_create(
        [Notification(user_id=uid, kind='action_required', message=message, link=link)
         for uid in user_ids],
        batch_size=500,
    )


def unjoin_packing(shipment: Shipment, user) -> Shipment:
    """Detach the packing of an export part into a new supply-plan row.

    The new row keeps the export row's date in its code, so the weekly-plan
    actual (keyed on the code's date) does not move to another day.

    Returns:
        The new supply-plan Shipment.

    Raises:
        ValueError: not an export part with packing, loading started, or pallets.
    """
    from apps.core.models import ShipmentStatusType
    from apps.export.services.shipment import generate_shipment_code
    from apps.export.services.task_rules import generate_tasks_for_status

    with transaction.atomic():
        row = Shipment.objects.select_for_update().select_related('status').get(pk=shipment.pk)
        if not (row.country_id and row.customer_id):
            raise ValueError(f'{row.shipment_code}: not a destination plan — nothing to detach from')
        if not has_packing(row):
            raise ValueError(f'{row.shipment_code}: has no packing to detach')
        assert_can_move_packing(row)

        draft = ShipmentStatusType.objects.get(code='draft')
        new = Shipment.objects.create(
            shipment_code=generate_shipment_code(today=row.date),
            date=row.date,
            season=row.season,
            status=draft,
            created_by=user,
            weight_net=packaging_weight(row),
            **{field: getattr(row, field) for field in PACKING_FIELDS},
        )
        ShipmentStatusLog.objects.create(
            shipment=new, status=draft, changed_by=user,
            comment=f'Created in Preparation — packing detached from {row.shipment_code}',
        )
        row.block_sources.update(shipment=new)
        new.varieties_dominant.set(row.varieties_dominant.all())
        row.varieties_dominant.clear()

        cleared = {field: None for field in PACKING_FIELDS}
        cleared.update(net_update(row, None))
        cleared['updated_by_id'] = user.pk
        # .update(): a packing move must never run auto-advance.
        Shipment.objects.filter(pk=row.pk).update(**cleared)
        ShipmentStatusLog.objects.create(
            shipment=row, status=row.status, changed_by=user,
            comment=f'Packing detached into {new.shipment_code}',
        )
        _notify_packing_change(
            [row], user,
            f'Packing of {row.shipment_code} was detached into {new.shipment_code} by {user.username}.',
        )

    # Same trade-off as the supply-plan create path: tasks after commit. Since
    # b318f0d8 a row with no destination gets no draft-step tasks.
    generate_tasks_for_status(new, 'draft')
    return new
