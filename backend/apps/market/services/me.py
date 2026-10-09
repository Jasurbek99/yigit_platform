"""The `/market/me/` payload."""
from apps.core.models import User
from apps.market.scoping import member_of


def build_me_payload(user: User) -> dict:
    """Who is using the market app, and for which agent (customer) and bazaar.

    `customer` is None for a user without an AgentMember; `bazaar` is None for an agent.
    """
    member = member_of(user)
    has_bazaar = bool(member and member.bazaar_id)
    return {
        'role': user.role,
        'username': user.username,
        'first_name': user.first_name,
        'customer': {'id': member.customer_id, 'name': member.customer.name} if member else None,
        'bazaar': {'id': member.bazaar_id, 'name': member.bazaar.name} if has_bazaar else None,
    }
