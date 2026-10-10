"""Sales, spoilage and expenses on a lot (spec §4).

Every create and delete locks the lot row first and only then reads what is
left, so two sellers' phones can never sell the same boxes twice. After the
write the lot is closed / reopened (totals.refresh_closed) and audited.
"""
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from apps.core.models import User
from apps.core.models.user import AGENT_ROLE
from apps.core.services_workflow import create_audit_entry
from apps.export.models import ExpenseCategory
from apps.market.expense_codes import MARKET_EXPENSES, OTHER_CODE
from apps.market.models import Buyer, Lot, LotExpense, Sale, Spoilage
from apps.market.scoping import customer_ids_for, member_of
from apps.market.services.access import MarketAccessError
from apps.market.services.lots import (
    AT_LEAST_ONE,
    ON_THE_ROAD_CODES,
    LotNotFound,
    MarketRuleError,
    check_report_open,
)
from apps.market.services.status import drive_first_sale
from apps.market.services.totals import lot_totals, needs_receipt, refresh_closed
from apps.market.text import boxes_ru

CENT = Decimal('0.01')
ZERO = Decimal('0')

NOT_LOT_SELLER = 'Продажи записывает продавец этой машины.'
NOT_ENTRY_OWNER = 'Удалить запись могут её автор или агент.'
NEEDS_RECEIPT = 'Пусть агент укажет, сколько ящиков пришло.'
LOT_CLOSED = 'Машина закрыта. Ящиков не осталось.'
ON_THE_ROAD = 'Машина ещё в пути — продавать можно после таможни назначения.'
ONLY_LEFT = 'В машине осталось только {boxes}'
PALLETS_LEFT = 'Больше нельзя: целых паллет осталось {pallets} ({boxes})'
NO_WHOLE_PALLET = 'На целую паллету не хватает. Осталось {boxes}.'
NEED_WEIGHT = 'Напишите вес с весов.'
BELOW_TARE = 'Вес меньше, чем весят пустые ящики ({boxes} по {tare} г).'
NEED_PRICE = 'Напишите цену за 1 кг.'
NEED_BUYER = 'Укажите покупателя.'
UNKNOWN_BUYER = 'Покупатель не найден.'
NOTHING_SPOILED = 'Укажите ящики или вес.'
NO_EXPENSES = 'Добавьте хотя бы один расход.'
UNKNOWN_CATEGORY = 'Такой статьи расходов нет.'
NEED_AMOUNT = 'Напишите сумму.'
NEED_LABEL = 'Напишите, на что потрачено.'
SALE_HAS_PAYMENT = 'По этой продаже уже есть оплата — сначала отмените оплату.'

_ENTRY_MODELS = {'sale': Sale, 'spoilage': Spoilage, 'expense': LotExpense}
_AUDIT_NAMES = {'sale': 'MarketSale', 'spoilage': 'MarketSpoilage', 'expense': 'MarketExpense'}


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def net_weight(gross_kg: Decimal, boxes: int, tare_g: int) -> Decimal:
    """Scale weight minus the empty boxes, to 0.01 kg."""
    return _money(gross_kg - Decimal(boxes * tare_g) / Decimal(1000))


def _locked_lot(user: User, lot_id: int) -> Lot:
    """The lot `lot_id`, row-locked. Call inside transaction.atomic().

    Scoped by customer, not by lots_for(): a seller of the same agent finds the
    lot (and is refused with 403 by the writer rule), a seller of another agent
    does not (404). The lock itself is a plain pk lookup with no joins.

    Raises:
        LotNotFound: the lot is not one of `user`'s customers.
    """
    scope = Lot.objects.filter(pk=lot_id)
    ids = customer_ids_for(user)
    if ids is not None:
        scope = scope.filter(shipment__customer_id__in=ids)
    if not scope.exists():
        raise LotNotFound()
    return Lot.objects.select_for_update().get(pk=lot_id)


def _check_lot_seller(user: User, lot: Lot) -> None:
    """Only the lot's seller records entries (the agent does not sell, spec Q19)."""
    if lot.seller_id is None or lot.seller_id != user.pk:
        raise MarketAccessError(NOT_LOT_SELLER)


def _check_past_customs(lot: Lot) -> None:
    """No sale / spoilage while the truck is still on the road, before destination customs.

    Opening the lot, the receipt, the seller and expenses stay allowed there.
    """
    if lot.shipment.status.code in ON_THE_ROAD_CODES:
        raise MarketRuleError(ON_THE_ROAD)


def _check_stock_open(lot: Lot) -> int:
    """Refuse a sale / spoilage on an unreceived or closed lot; return the boxes left (read under the lock)."""
    if needs_receipt(lot):
        raise MarketRuleError(NEEDS_RECEIPT)
    left = lot_totals(lot)['left']
    if lot.closed_at is not None or left <= 0:
        raise MarketRuleError(LOT_CLOSED)
    return left


def _sale_boxes(lot: Lot, unit: str, qty: int | None, left: int) -> tuple[int, int]:
    """`(qty, boxes)` of a sale by box, pallet or whole truck, checked against `left`."""
    if unit == Sale.UNIT_TRUCK:
        return 1, left
    if qty is None or qty < 1:
        raise MarketRuleError(AT_LEAST_ONE, 'qty')
    if unit == Sale.UNIT_PALLET:
        per_pallet = lot.boxes_per_pallet
        whole = left // per_pallet
        if whole == 0:
            raise MarketRuleError(NO_WHOLE_PALLET.format(boxes=boxes_ru(left)), 'qty')
        if qty > whole:
            raise MarketRuleError(PALLETS_LEFT.format(pallets=whole, boxes=boxes_ru(whole * per_pallet)), 'qty')
        boxes = qty * per_pallet
    else:
        boxes = qty
    if boxes > left:
        raise MarketRuleError(ONLY_LEFT.format(boxes=boxes_ru(left)), 'qty')
    return qty, boxes


def _below_tare(boxes: int, tare_g: int) -> MarketRuleError:
    """The error for a scale weight that does not exceed the empty boxes."""
    return MarketRuleError(BELOW_TARE.format(boxes=boxes_ru(boxes), tare=tare_g), 'gross_kg')


def _debt_buyer(lot: Lot, buyer_id: int | None, paid_on_spot: bool) -> Buyer | None:
    """The sale's buyer: required on debt, and always one of the lot's customer."""
    if buyer_id is None:
        if not paid_on_spot:
            raise MarketRuleError(NEED_BUYER, 'buyer_id')
        return None
    buyer = Buyer.objects.filter(pk=buyer_id, customer_id=lot.shipment.customer_id).first()
    if buyer is None:
        raise MarketRuleError(UNKNOWN_BUYER, 'buyer_id')
    return buyer


def create_sale(user: User, lot_id: int, data: dict) -> Sale:
    """Record a sale on the lot by its seller.

    `data`: unit ('box' | 'pallet' | 'truck'), qty (ignored for a truck),
    gross_kg, price_kg, total (optional; > 0 overrides net × price),
    paid_on_spot, buyer_id (required when not paid on the spot).
    The lot's first sale schedules drive_first_sale() after commit.

    Raises:
        LotNotFound: the lot is not in `user`'s customers.
        MarketAccessError: `user` is not the lot's seller.
        MarketRuleError: the truck is still on the road, or a stock, weight, price
            or buyer rule refuses the sale.
    """
    with transaction.atomic():
        lot = _locked_lot(user, lot_id)
        _check_lot_seller(user, lot)
        check_report_open(lot)
        _check_past_customs(lot)
        left = _check_stock_open(lot)
        qty, boxes = _sale_boxes(lot, data.get('unit') or Sale.UNIT_BOX, data.get('qty'), left)
        gross_kg = data.get('gross_kg')
        if gross_kg is None or gross_kg <= ZERO:
            raise MarketRuleError(NEED_WEIGHT, 'gross_kg')
        net_kg = net_weight(gross_kg, boxes, lot.tare_g)
        if net_kg <= ZERO:
            raise _below_tare(boxes, lot.tare_g)
        price_kg = data.get('price_kg')
        if price_kg is None or price_kg <= ZERO:
            raise MarketRuleError(NEED_PRICE, 'price_kg')
        paid_on_spot = data.get('paid_on_spot', True)
        buyer = _debt_buyer(lot, data.get('buyer_id'), paid_on_spot)
        calc_total = _money(net_kg * price_kg)
        manual = data.get('total')
        is_first = not lot.sales.exists()
        sale = Sale.objects.create(
            lot=lot, unit=data.get('unit') or Sale.UNIT_BOX, qty=qty, boxes=boxes, gross_kg=_money(gross_kg),
            tare_g=lot.tare_g, net_kg=net_kg, price_kg=price_kg, calc_total=calc_total,
            total=_money(manual) if manual is not None and manual > ZERO else calc_total,
            paid_on_spot=paid_on_spot, buyer=buyer, created_by=user,
        )
        refresh_closed(lot)
        create_audit_entry(user, 'create', 'MarketSale', sale.pk, lot.shipment.shipment_code,
                           f'{sale.unit} ×{qty}: {boxes} boxes, {net_kg} kg, {sale.total}')
        if is_first:
            transaction.on_commit(lambda: drive_first_sale(lot.pk, user))
    return sale


def create_spoilage(user: User, lot_id: int, data: dict) -> Spoilage:
    """Write boxes and / or kg off the lot (seller only). `data`: boxes (≥ 0), gross_kg (optional).

    Raises:
        LotNotFound, MarketAccessError: as create_sale.
        MarketRuleError: the truck is still on the road, nothing written off, more
            boxes than left, weight below the tare.
    """
    boxes, gross_kg = data.get('boxes') or 0, data.get('gross_kg')
    with transaction.atomic():
        lot = _locked_lot(user, lot_id)
        _check_lot_seller(user, lot)
        check_report_open(lot)
        _check_past_customs(lot)
        left = _check_stock_open(lot)
        if boxes <= 0 and (gross_kg is None or gross_kg <= ZERO):
            raise MarketRuleError(NOTHING_SPOILED)
        if boxes > left:
            raise MarketRuleError(ONLY_LEFT.format(boxes=boxes_ru(left)), 'boxes')
        net_kg = net_weight(gross_kg, boxes, lot.tare_g) if gross_kg is not None else ZERO
        if net_kg < ZERO:
            raise _below_tare(boxes, lot.tare_g)
        spoilage = Spoilage.objects.create(
            lot=lot, boxes=boxes, gross_kg=_money(gross_kg) if gross_kg is not None else None,
            tare_g=lot.tare_g, net_kg=net_kg, created_by=user,
        )
        refresh_closed(lot)
        create_audit_entry(user, 'create', 'MarketSpoilage', spoilage.pk, lot.shipment.shipment_code,
                           f'{boxes} boxes, {net_kg} kg')
    return spoilage


def _checked_expense_rows(rows: list[dict]) -> list[tuple[ExpenseCategory, Decimal, str]]:
    """`(category, amount, label)` per row; every row checked before any is saved.

    Only active market categories count, as in the reference list (services.reference).
    """
    if not rows:
        raise MarketRuleError(NO_EXPENSES)
    codes = {code for code, _ in MARKET_EXPENSES}
    categories = {c.pk: c for c in ExpenseCategory.objects.filter(code__in=codes, is_active=True)}
    checked = []
    for row in rows:
        category = categories.get(row.get('category_id'))
        if category is None:
            raise MarketRuleError(UNKNOWN_CATEGORY, 'category_id')
        amount = row.get('amount')
        if amount is None or amount <= ZERO:
            raise MarketRuleError(NEED_AMOUNT, 'amount')
        label = (row.get('label') or '').strip()
        if category.code == OTHER_CODE and not label:
            raise MarketRuleError(NEED_LABEL, 'label')
        checked.append((category, _money(amount), label))
    return checked


def create_expenses(user: User, lot_id: int, rows: list[dict]) -> list[LotExpense]:
    """Record one sheet of selling costs (seller only); allowed on a closed lot, not after the report is approved.

    Each row: `{category_id, amount, label?}`; `label` is required for OTHER.

    Raises:
        LotNotFound, MarketAccessError: as create_sale.
        MarketRuleError: the report is approved, no rows, an unknown or inactive category, amount ≤ 0, OTHER without label.
    """
    with transaction.atomic():
        lot = _locked_lot(user, lot_id)
        _check_lot_seller(user, lot)
        check_report_open(lot)
        checked = _checked_expense_rows(rows)
        expenses = []
        for category, amount, label in checked:  # one by one: no bulk_create on MSSQL Decimal batches
            expense = LotExpense.objects.create(lot=lot, category=category, amount=amount, label=label,
                                                created_by=user)
            create_audit_entry(user, 'create', 'MarketExpense', expense.pk, lot.shipment.shipment_code,
                               f'{category.code} {amount}')
            expenses.append(expense)
    return expenses


def _check_can_delete(user: User, lot: Lot, entry) -> None:
    """The entry's author while he is still the lot's seller, or the agent of the lot's customer."""
    member = member_of(user)
    if user.role == AGENT_ROLE and member is not None and member.customer_id == lot.shipment.customer_id:
        return
    if entry.created_by_id == user.pk and lot.seller_id == user.pk:
        return
    raise MarketAccessError(NOT_ENTRY_OWNER)


def delete_entry(user: User, kind: str, entry_id: int, lot_id: int | None = None) -> None:
    """Delete a sale, spoilage or expense; a freed box reopens the lot.

    `kind` is 'sale', 'spoilage' or 'expense'. With `lot_id` set (the URL's
    lot) an entry of another lot is not found.

    Raises:
        LotNotFound: no such entry on a lot of `user`'s customers.
        MarketAccessError: `user` is neither the author-seller nor the agent.
        MarketRuleError: the sales report is approved (any kind), or a sale
            already has a payment allocated to it.
    """
    model = _ENTRY_MODELS[kind]
    found_lot_id = model.objects.filter(pk=entry_id).values_list('lot_id', flat=True).first()
    if found_lot_id is None or (lot_id is not None and found_lot_id != lot_id):
        raise LotNotFound()
    with transaction.atomic():
        lot = _locked_lot(user, found_lot_id)
        # Read again under the lock: a parallel delete may have removed it. A sale row
        # is locked too, so a payment can't be allocated to it while it is deleted.
        entries = model.objects.select_for_update() if kind == 'sale' else model.objects
        entry = entries.filter(pk=entry_id, lot=lot).first()
        if entry is None:
            raise LotNotFound()
        _check_can_delete(user, lot, entry)
        check_report_open(lot)
        if kind == 'sale' and entry.allocations.exists():
            raise MarketRuleError(SALE_HAS_PAYMENT)
        entry.delete()
        refresh_closed(lot)
        create_audit_entry(user, 'update', _AUDIT_NAMES[kind], entry_id, lot.shipment.shipment_code, 'deleted')
