"""Reference lists the seller's forms pick from: selling-cost categories and the agent's buyers."""
from django.db import IntegrityError, transaction
from django.db.models import QuerySet

from apps.core.models import User
from apps.export.models import ExpenseCategory
from apps.market.expense_codes import MARKET_EXPENSES
from apps.market.models import Buyer
from apps.market.scoping import customer_ids_for
from apps.market.services.access import own_market_customer

MAX_BUYER_MATCHES = 20


def market_expense_categories() -> list[dict]:
    """Active market expense categories as `{id, code, label}`, in MARKET_EXPENSES order.

    The label is the market's own (INTERES shows as «Комиссия»), not the category's name_ru.
    """
    order = {code: i for i, (code, _) in enumerate(MARKET_EXPENSES)}
    labels = dict(MARKET_EXPENSES)
    rows = ExpenseCategory.objects.filter(code__in=order, is_active=True)
    return [{'id': c.pk, 'code': c.code, 'label': labels[c.code]} for c in sorted(rows, key=lambda c: order[c.code])]


def search_buyers(user: User, q: str) -> QuerySet[Buyer]:
    """Up to 20 buyers whose name contains `q`, of the customers `user` may see."""
    qs = Buyer.objects.all()
    ids = customer_ids_for(user)
    if ids is not None:
        qs = qs.filter(customer_id__in=ids)
    if q:
        qs = qs.filter(name__icontains=q)
    return qs.order_by('name')[:MAX_BUYER_MATCHES]


def get_or_create_buyer(user: User, name: str, phone: str = '') -> tuple[Buyer, bool]:
    """The agent's buyer called `name` (case-insensitive), created if new. Returns `(buyer, created)`.

    Raises:
        MarketAccessError: `user` is not the agent or one of his sellers.
    """
    customer = own_market_customer(user)
    name = name.strip()
    found = Buyer.objects.filter(customer=customer, name__iexact=name).first()
    if found:
        return found, False
    try:
        with transaction.atomic():
            return Buyer.objects.create(customer=customer, name=name, phone=phone.strip()), True
    except IntegrityError:
        # Another seller added the same name in between (the unique index is case-insensitive).
        return Buyer.objects.get(customer=customer, name__iexact=name), False
