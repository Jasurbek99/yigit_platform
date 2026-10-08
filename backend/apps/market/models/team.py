from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class Bazaar(models.Model):
    """A market where one of the agent's sellers works."""

    customer = models.ForeignKey('core.Customer', on_delete=models.PROTECT, related_name='bazaars')
    name = models.CharField(max_length=60, **cyrillic_collation())
    city = models.ForeignKey('core.City', on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('market', 'bazaars')
        ordering = ['name']
        constraints = [models.UniqueConstraint(fields=['customer', 'name'], name='market_bazaar_customer_name_uniq')]

    def __str__(self) -> str:
        return self.name


class AgentMember(models.Model):
    """Binds an external login (role agent / agent_seller) to its agent (core.Customer)."""

    user = models.OneToOneField('core.User', on_delete=models.CASCADE, related_name='agent_member')
    customer = models.ForeignKey('core.Customer', on_delete=models.PROTECT, related_name='agent_members')
    # Sellers only: the bazaar they work at.
    bazaar = models.ForeignKey(Bazaar, on_delete=models.PROTECT, null=True, blank=True, related_name='members')

    class Meta:
        db_table = schema_table('market', 'agent_members')

    def __str__(self) -> str:
        return f'{self.user.username} → {self.customer.name}'
