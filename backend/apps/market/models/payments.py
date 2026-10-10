"""Buyer payments of debts and how each payment was spread over the buyer's unpaid sales."""
from django.db import models

from apps.core.db_utils import schema_table
from apps.market.models.lots import MONEY, Buyer, Sale


class Payment(models.Model):
    """Money a buyer brought for his debts, in one currency."""

    buyer = models.ForeignKey(Buyer, on_delete=models.PROTECT, related_name='payments')
    currency = models.CharField(max_length=3)
    amount = models.DecimalField(**MONEY)
    paid_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('core.User', on_delete=models.PROTECT, related_name='+')

    class Meta:
        db_table = schema_table('market', 'payments')
        ordering = ['-paid_at', '-pk']

    def __str__(self) -> str:
        return f'Payment {self.pk} ({self.amount} {self.currency})'


class PaymentAllocation(models.Model):
    """The part of a payment counted against one sale."""

    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name='allocations')
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name='allocations')
    amount = models.DecimalField(**MONEY)

    class Meta:
        db_table = schema_table('market', 'payment_allocations')

    def __str__(self) -> str:
        return f'{self.amount} → sale {self.sale_id}'
