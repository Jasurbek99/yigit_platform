"""Buyer payments of debts and the debts list (spec Part C).

A payment is spread over the buyer's unpaid sales the payer may see, oldest
first, in one currency (KZT and RUB are never summed). Lock order: the Buyer
row first, then every target Sale row (plain pk lookups, no joins, so no Lot
is locked), and only then are the dues read — each allocation is at most what
its sale still owes at that moment. Entry deletes lock Lot → Sale and never a
Buyer, so there is no cycle. Payments stay allowed after the sales report is
approved (no check_report_open here).
"""
from collections import OrderedDict
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import QuerySet

from apps.core.models import User
from apps.core.models.user import AGENT_ROLE, EXTERNAL_ROLES
from apps.core.services_workflow import create_audit_entry
from apps.market.models import Buyer, Payment, PaymentAllocation, Sale
from apps.market.scoping import customer_ids_for, member_of
from apps.market.services.access import NOT_MARKET_MEMBER, MarketAccessError
from apps.market.services.dues import debt_sales, with_allocated
from apps.market.services.lots import LotNotFound, MarketRuleError, lots_for

CENT = Decimal('0.01')
ZERO = Decimal('0')
LATEST_PAYMENTS = 10

NOTHING_DUE = 'У покупателя нет долга.'
NEED_PAY_AMOUNT = 'Напишите сумму.'
NOT_PAYMENT_OWNER = 'Отменить оплату могут её автор или агент.'
NOT_YOUR_SALE = 'Эту продажу вы не видите.'


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def debt_scope(user: User) -> QuerySet[Sale]:
    """The sales `user` sees for debts: those on lots_for(user).

    Seller: his lots. Agent: every lot of his customer. Staff: the lots of
    customer_ids_for() (read only). Anyone else: none.
    """
    return Sale.objects.filter(lot__in=lots_for(user).order_by())


def _in_customer_scope(user: User, qs: QuerySet, customer_path: str) -> QuerySet:
    """`qs` limited to `user`'s customers (customer_ids_for); `customer_path` is the lookup to the customer id."""
    ids = customer_ids_for(user)
    return qs if ids is None else qs.filter(**{f'{customer_path}__in': ids})


def _is_customer_agent(user: User, customer_id: int) -> bool:
    member = member_of(user)
    return user.role == AGENT_ROLE and member is not None and member.customer_id == customer_id


def _locked_dues(sale_ids: list[int]) -> list[tuple[int, Decimal]]:
    """`(sale_id, due)` of the debt sales among `sale_ids`, oldest first, owing > 0.

    Call after the sale rows are locked; the due is read fresh.
    """
    rows = with_allocated(Sale.objects.filter(pk__in=sale_ids)).order_by('sold_at', 'pk')
    dues = [(pk, _money(total - allocated)) for pk, total, allocated in rows.values_list('pk', 'total', 'allocated')]
    return [(pk, due) for pk, due in dues if due > ZERO]


def _lock_sales(sale_ids: list[int]) -> list[int]:
    """Row-lock the sales (plain pk lookup, no joins); return the ids that still exist."""
    return list(Sale.objects.select_for_update().filter(pk__in=sale_ids).order_by('pk').values_list('pk', flat=True))


def _allocate(user: User, buyer: Buyer, currency: str, amount: Decimal, dues: list[tuple[int, Decimal]]) -> Payment:
    """Create the payment of `amount` and its allocations, oldest due first; audit it."""
    payment = Payment.objects.create(buyer=buyer, currency=currency, amount=amount, created_by=user)
    rest = amount
    for sale_id, due in dues:  # one by one: no bulk_create on MSSQL Decimal batches
        if rest <= ZERO:
            break
        part = min(due, rest)
        PaymentAllocation.objects.create(payment=payment, sale_id=sale_id, amount=part)
        rest -= part
    create_audit_entry(user, 'create', 'MarketPayment', payment.pk, buyer.name, f'{amount} {currency}')
    return payment


def create_payment(user: User, buyer_id: int, currency: str, amount: Decimal | None) -> Payment:
    """Record money the buyer brought and spread it over his unpaid sales in `user`'s scope, oldest first.

    The recorded amount is at most what those sales owe in `currency`.

    Raises:
        MarketAccessError: `user` is not an agent or seller (staff only read).
        MarketRuleError: amount missing or ≤ 0 (field 'amount'); nothing due in that currency.
        LotNotFound: the buyer is not one of `user`'s customer.
    """
    member = member_of(user)
    if user.role not in EXTERNAL_ROLES or member is None:
        raise MarketAccessError(NOT_MARKET_MEMBER)
    if amount is None or amount <= ZERO:
        raise MarketRuleError(NEED_PAY_AMOUNT, 'amount')
    if not Buyer.objects.filter(pk=buyer_id, customer_id=member.customer_id).exists():
        raise LotNotFound()
    with transaction.atomic():
        buyer = Buyer.objects.select_for_update().get(pk=buyer_id)
        candidates = list(debt_scope(user).filter(buyer=buyer, lot__currency=currency, paid_on_spot=False)
                          .order_by().values_list('pk', flat=True))
        dues = _locked_dues(_lock_sales(candidates))
        total_due = sum((due for _, due in dues), ZERO)
        if total_due <= ZERO:
            raise MarketRuleError(NOTHING_DUE)
        return _allocate(user, buyer, currency, min(_money(amount), total_due), dues)


def mark_sale_paid(user: User, sale_id: int) -> Payment:
    """Record that the buyer paid one debt sale in full (the lot's agent or seller).

    Raises:
        LotNotFound: the sale is not on a lot of `user`'s customers.
        MarketAccessError: `user` is neither the agent of the customer nor the lot's seller.
        MarketRuleError: the sale owes nothing.
    """
    sale = (_in_customer_scope(user, Sale.objects.filter(pk=sale_id), 'lot__shipment__customer_id')
            .select_related('lot__shipment').first())
    if sale is None:
        raise LotNotFound()
    lot = sale.lot
    if not (_is_customer_agent(user, lot.shipment.customer_id) or lot.seller_id == user.pk):
        raise MarketAccessError(NOT_YOUR_SALE)
    if sale.paid_on_spot or sale.buyer_id is None:
        raise MarketRuleError(NOTHING_DUE)
    with transaction.atomic():
        buyer = Buyer.objects.select_for_update().get(pk=sale.buyer_id)
        dues = _locked_dues(_lock_sales([sale.pk]))
        if not dues:
            raise MarketRuleError(NOTHING_DUE)
        return _allocate(user, buyer, lot.currency, dues[0][1], dues)


def delete_payment(user: User, payment_id: int) -> None:
    """Undo a payment: its allocations go with it, so the sales owe again.

    Found by customer (like entries): a seller of the same agent gets 403, another agent's team 404.

    Raises:
        LotNotFound: no such payment of a buyer of `user`'s customers.
        MarketAccessError: `user` is neither its author nor the agent of the customer.
    """
    payment = (_in_customer_scope(user, Payment.objects.filter(pk=payment_id), 'buyer__customer_id')
               .select_related('buyer').first())
    if payment is None:
        raise LotNotFound()
    if payment.created_by_id != user.pk and not _is_customer_agent(user, payment.buyer.customer_id):
        raise MarketAccessError(NOT_PAYMENT_OWNER)
    with transaction.atomic():
        _lock_sales(list(PaymentAllocation.objects.filter(payment_id=payment_id).values_list('sale_id', flat=True)))
        # Read again under the locks: a parallel undo may have removed it.
        deleted, _ = Payment.objects.filter(pk=payment_id).delete()
        if not deleted:
            raise LotNotFound()
        create_audit_entry(user, 'update', 'MarketPayment', payment_id, payment.buyer.name, 'deleted')


def _latest_payments(scope: QuerySet[Sale], buyer_id: int, currency: str) -> list[dict]:
    """The buyer's latest payments in `currency` that touch a sale of `scope`."""
    touching = PaymentAllocation.objects.filter(sale__in=scope.order_by()).values('payment_id')
    payments = (Payment.objects.filter(buyer_id=buyer_id, currency=currency, pk__in=touching)
                .select_related('created_by')[:LATEST_PAYMENTS])
    return [{'id': p.pk, 'amount': p.amount, 'paid_at': p.paid_at,
             'created_by': {'id': p.created_by_id, 'name': p.created_by.first_name or p.created_by.username}}
            for p in payments]


def buyer_debts(user: User) -> list[dict]:
    """What each buyer owes in `user`'s scope, one group per (buyer, currency).

    Group: `{buyer: {id, name}, currency, due, since, sales: [...] (oldest first),
    payments: [...] (latest 10 touching the scope)}`; groups sorted by currency,
    then due descending. Money is Decimal, times are datetimes (the serializer formats them).
    """
    scope = debt_scope(user)
    # Plain values: MSSQL groups the allocation Sum by every selected column.
    rows = debt_sales(scope).order_by('sold_at', 'pk').values(
        'pk', 'lot_id', 'lot__currency', 'lot__shipment__shipment_code', 'buyer_id', 'buyer__name',
        'sold_at', 'unit', 'boxes', 'net_kg', 'total', 'allocated',
    )
    groups: OrderedDict[tuple[int, str], dict] = OrderedDict()
    for row in rows:
        key = (row['buyer_id'], row['lot__currency'])
        group = groups.get(key)
        if group is None:
            group = groups[key] = {'buyer': {'id': row['buyer_id'], 'name': row['buyer__name']},
                                   'currency': row['lot__currency'], 'due': ZERO, 'since': row['sold_at'],
                                   'sales': []}
        due = _money(row['total'] - row['allocated'])
        group['due'] += due
        group['sales'].append({'id': row['pk'], 'lot_id': row['lot_id'],
                               'shipment_code': row['lot__shipment__shipment_code'], 'sold_at': row['sold_at'],
                               'unit': row['unit'], 'boxes': row['boxes'], 'net_kg': row['net_kg'],
                               'total': row['total'], 'due': due})
    for (buyer_id, currency), group in groups.items():
        group['payments'] = _latest_payments(scope, buyer_id, currency)
    return sorted(groups.values(), key=lambda g: (g['currency'], -g['due']))


def debt_totals(user: User) -> dict[str, str]:
    """`{currency: due}` over `user`'s scope; currencies with no debt are left out."""
    totals: dict[str, Decimal] = {}
    for currency, total, allocated in debt_sales(debt_scope(user)).order_by().values_list(
            'lot__currency', 'total', 'allocated'):
        totals[currency] = totals.get(currency, ZERO) + _money(total - allocated)
    return {currency: str(_money(due)) for currency, due in sorted(totals.items())}
