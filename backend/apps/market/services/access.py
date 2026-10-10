"""Who may write what in the market, beyond the permission matrix."""
from apps.core.models import Customer, User
from apps.core.models.user import AGENT_ROLE, EXTERNAL_ROLES
from apps.market.scoping import customer_ids_for, member_of

NOT_TEAM_OWNER = 'Командой управляет только агент.'
NOT_MARKET_MEMBER = 'Это делают агент и его продавцы.'
NOT_YOUR_CUSTOMER = 'Это не ваш клиент.'


class MarketAccessError(Exception):
    """A market rule refuses the caller. Market views answer 403 with the (Russian) message."""


def own_team_customer(user: User) -> Customer:
    """Return the agent whose team `user` manages.

    Team writes belong to the agent itself; staff and sellers only read.

    Raises:
        MarketAccessError: `user` is not an agent bound to a customer.
    """
    member = member_of(user)
    if user.role != AGENT_ROLE or member is None:
        raise MarketAccessError(NOT_TEAM_OWNER)
    return member.customer


def own_market_customer(user: User) -> Customer:
    """Return the agent (customer) whose bazaar work `user` does: the agent or one of his sellers.

    Raises:
        MarketAccessError: `user` is not an agent or seller bound to a customer.
    """
    member = member_of(user)
    if user.role not in EXTERNAL_ROLES or member is None:
        raise MarketAccessError(NOT_MARKET_MEMBER)
    return member.customer


def check_customer_in_scope(user: User, customer: Customer) -> None:
    """Refuse an agent login for a customer outside `user`'s scope (a sales rep's own customers).

    Raises:
        MarketAccessError: `customer` is not one `user` may see.
    """
    ids = customer_ids_for(user)
    if ids is not None and customer.pk not in ids:
        raise MarketAccessError(NOT_YOUR_CUSTOMER)
