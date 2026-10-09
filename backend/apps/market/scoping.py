"""Which agents (core.Customer ids) a user may see in the market app.

Every market queryset filters through customer_ids_for(), list and detail alike —
unlike export's shipment detail routes, which are deliberately unscoped.
"""
from apps.core.models import Customer
from apps.core.models.user import EXTERNAL_ROLES
from apps.market.models import AgentMember

STAFF_ALL = frozenset({'admin', 'boss', 'director', 'export_manager', 'document_team'})


def member_of(user) -> AgentMember | None:
    """The user's AgentMember binding, or None for a user outside any agent's team."""
    try:
        return user.agent_member
    except AgentMember.DoesNotExist:
        return None


def customer_ids_for(user) -> list[int] | None:
    """Customer ids `user` may see: None = every customer; [] = none."""
    role = getattr(user, 'role', None)
    if role in EXTERNAL_ROLES:
        member = member_of(user)
        return [member.customer_id] if member else []
    if role == 'sales_rep':
        return list(Customer.objects.filter(sales_rep=user).values_list('pk', flat=True))
    if role in STAFF_ALL or getattr(user, 'is_superuser', False):
        return None
    return []
