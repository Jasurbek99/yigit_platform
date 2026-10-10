"""Lots: which trucks an agent may sell, opening one, the seller's QR claim, the agent's receipt."""
from decimal import Decimal

from django.db import transaction
from django.db.models import F, QuerySet

from apps.core.models import User
from apps.core.models.user import AGENT_ROLE, AGENT_SELLER_ROLE
from apps.core.services_workflow import create_audit_entry
from apps.export.models import Shipment
from apps.market.models import Lot
from apps.market.scoping import customer_ids_for, member_of
from apps.market.services.access import MarketAccessError
from apps.market.services.totals import lot_totals, refresh_closed

# Departed but not past destination customs: the lot opens, nothing is sold or written off yet.
ON_THE_ROAD_CODES = ('yola_chykdy', 'serhet_gechdi', 'dest_entry')
# From departure to sold: the trucks an agent sees coming and sells (spec §2).
VISIBLE_STATUS_CODES = (
    *ON_THE_ROAD_CODES, 'barysh_gumrugi', 'transshipment', 'bardy', 'satylyar', 'satyldy',
)
MAX_TARE_G = 20000

NOT_AGENT = 'Машины видит только агент.'
NOT_LOT_AGENT = 'Машину настраивает только агент.'
NOT_LOT_OPENER = 'Машину открывают агент и его продавцы.'
OTHER_SELLER = 'Машина назначена другому продавцу.'
UNKNOWN_SELLER = 'Такого продавца у агента нет.'
BELOW_USED = 'Уже продано или списано: {used} ящиков. Меньше поставить нельзя.'
AT_LEAST_ONE = 'Не меньше 1.'
BAD_TARE = f'От 0 до {MAX_TARE_G} г.'
NEGATIVE_PRICE = 'Цена не может быть меньше нуля.'


class MarketRuleError(Exception):
    """A market rule refuses the input. Market views answer 400.

    With `field` set the body is `{field: [message]}`, else `{"error": message}`.
    """

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.field = field


class LotNotFound(Exception):
    """The shipment or lot is not one the caller may open. Market views answer 404."""


def _customer_shipments(customer_id: int) -> QuerySet[Shipment]:
    """Live shipments of one customer in the statuses the market works with."""
    return Shipment.objects.filter(
        customer_id=customer_id, status__code__in=VISIBLE_STATUS_CODES, deleted_at__isnull=True,
    )


def visible_shipments(user: User) -> QuerySet[Shipment]:
    """The trucks the agent `user` may open a lot on.

    Raises:
        MarketAccessError: `user` is not an agent bound to a customer (staff, sellers).
    """
    member = member_of(user)
    if user.role != AGENT_ROLE or member is None:
        raise MarketAccessError(NOT_AGENT)
    return _customer_shipments(member.customer_id)


def available_shipments(user: User) -> QuerySet[Shipment]:
    """visible_shipments() for the agent's list: with `lot_id`, arrived first, then in transit."""
    return (visible_shipments(user)
            .select_related('status', 'product_type')
            .annotate(lot_id=F('market_lot__id'))
            .order_by('-status__step_order', '-date', '-pk'))


def lots_for(user: User) -> QuerySet[Lot]:
    """The lots `user` may see. Not season-scoped: a lot is sold off whatever the season.

    Seller: the lots assigned to him. Agent: every lot of his customer.
    Staff: the lots of the customers customer_ids_for() gives them.
    """
    qs = Lot.objects.all()
    member = member_of(user)
    if user.role == AGENT_SELLER_ROLE:
        return qs.filter(seller=user)
    if user.role == AGENT_ROLE:
        return qs.filter(shipment__customer_id=member.customer_id) if member else qs.none()
    ids = customer_ids_for(user)
    return qs if ids is None else qs.filter(shipment__customer_id__in=ids)


def _new_lot_defaults(shipment: Shipment) -> dict:
    """Receipt defaults from the shipment.

    A missing box count opens with a placeholder of 1 box, a missing pallet count
    with 1 box per pallet; either leaves the receipt unconfirmed (needs_receipt)
    until the agent PATCHes boxes_received or boxes_per_pallet.
    """
    boxes, pallets = shipment.box_count or 0, shipment.pallet_count or 0
    currency = shipment.country.currency if shipment.country_id else None
    known = boxes > 0 and pallets > 0
    return {
        'boxes_received': boxes if boxes > 0 else 1,
        'receipt_confirmed': known,
        # More pallets than boxes would give 0 per pallet; a pallet sale divides by it.
        'boxes_per_pallet': max(1, boxes // pallets) if known else 1,
        'currency': currency or 'KZT',
    }


def open_lot(user: User, shipment_id: int) -> tuple[Lot, bool]:
    """Open (get or create) the lot of a shipment. Returns `(lot, created)`.

    The agent opens any truck he sees. A seller opens a truck of his customer by
    scanning its QR: an unassigned lot becomes his, his own lot opens, another
    seller's lot is refused.

    Raises:
        LotNotFound: the shipment is not one `user` may open.
        MarketAccessError: `user` is staff, or the lot belongs to another seller.
    """
    member = member_of(user)
    if user.role == AGENT_ROLE:
        candidates = visible_shipments(user)
    elif user.role == AGENT_SELLER_ROLE and member is not None:
        candidates = _customer_shipments(member.customer_id)
    else:
        raise MarketAccessError(NOT_LOT_OPENER)
    if not candidates.filter(pk=shipment_id).exists():
        raise LotNotFound()
    with transaction.atomic():
        # Plain lock, no joins: two scans of the same QR must not open two lots.
        shipment = Shipment.objects.select_for_update().get(pk=shipment_id)
        # Lock order Shipment → Lot; the lot lock keeps a claim from overwriting
        # a seller the agent set meanwhile (update_lot locks the lot too).
        lot = Lot.objects.select_for_update().filter(shipment=shipment).first()
        created = lot is None
        if created:
            lot = Lot.objects.create(shipment=shipment, opened_by=user, **_new_lot_defaults(shipment))
            create_audit_entry(user, 'create', 'MarketLot', lot.pk, shipment.shipment_code, 'lot opened')
        if user.role == AGENT_SELLER_ROLE:
            _claim(user, lot)
    return lot, created


def _claim(seller: User, lot: Lot) -> None:
    """Give an unassigned lot to `seller`; refuse a lot of another seller."""
    if lot.seller_id == seller.pk:
        return
    if lot.seller_id is not None:
        raise MarketAccessError(OTHER_SELLER)
    lot.seller = seller
    lot.save(update_fields=['seller'])
    create_audit_entry(seller, 'update', 'MarketLot', lot.pk, lot.shipment.shipment_code, 'seller claimed by QR')


def update_lot(user: User, lot: Lot, data: dict) -> Lot:
    """The agent sets the lot's seller and receipt (boxes, boxes per pallet, tare, default price).

    `data` keys (all optional): seller_id, boxes_received, boxes_per_pallet,
    tare_g, default_price_kg. Sending boxes_received or boxes_per_pallet
    confirms the receipt. Recomputes closed_at and audits the changed keys.

    Raises:
        MarketAccessError: `user` is not the agent of the lot's customer.
        MarketRuleError: a value breaks a receipt rule.
    """
    member = member_of(user)
    if user.role != AGENT_ROLE or member is None or member.customer_id != lot.shipment.customer_id:
        raise MarketAccessError(NOT_LOT_AGENT)
    with transaction.atomic():
        lot = Lot.objects.select_for_update().get(pk=lot.pk)
        values = _checked_values(lot, member.customer_id, data)
        if 'boxes_received' in values or 'boxes_per_pallet' in values:
            # The agent's receipt, even if it repeats the placeholder value.
            values['receipt_confirmed'] = True
        changed = [k for k, v in values.items() if getattr(lot, k) != v]
        for key in changed:
            setattr(lot, key, values[key])
        if changed:
            lot.save(update_fields=[k.removesuffix('_id') for k in changed])
        refresh_closed(lot)
        if changed:
            create_audit_entry(user, 'update', 'MarketLot', lot.pk, lot.shipment.shipment_code,
                               f'changed: {", ".join(changed)}')
    return lot


def _checked_values(lot: Lot, customer_id: int, data: dict) -> dict:
    """The receipt values in `data`, each checked against its rule (MarketRuleError otherwise)."""
    values = {}
    if 'seller_id' in data:
        seller_id = data['seller_id']
        if seller_id is not None and not User.objects.filter(
            pk=seller_id, role=AGENT_SELLER_ROLE, is_active=True, agent_member__customer_id=customer_id,
        ).exists():
            raise MarketRuleError(UNKNOWN_SELLER, 'seller_id')
        values['seller_id'] = seller_id
    if 'boxes_received' in data:
        boxes = data['boxes_received']
        if boxes < 1:
            raise MarketRuleError(AT_LEAST_ONE, 'boxes_received')
        used = lot_totals(lot)['used']
        if boxes < used:
            raise MarketRuleError(BELOW_USED.format(used=used))
        values['boxes_received'] = boxes
    if 'boxes_per_pallet' in data:
        if data['boxes_per_pallet'] < 1:
            raise MarketRuleError(AT_LEAST_ONE, 'boxes_per_pallet')
        values['boxes_per_pallet'] = data['boxes_per_pallet']
    if 'tare_g' in data:
        if not 0 <= data['tare_g'] <= MAX_TARE_G:
            raise MarketRuleError(BAD_TARE, 'tare_g')
        values['tare_g'] = data['tare_g']
    if 'default_price_kg' in data:
        price = data['default_price_kg']
        if price is not None and price < Decimal('0'):
            raise MarketRuleError(NEGATIVE_PRICE, 'default_price_kg')
        values['default_price_kg'] = price
    return values
