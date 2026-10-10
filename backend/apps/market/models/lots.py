"""A truck being sold at the bazaar (Lot) and everything recorded on it."""
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table

MONEY = {'max_digits': 12, 'decimal_places': 2}


class Lot(models.Model):
    """One shipment (truck) being sold by an agent; created on first open (spec §2, §4)."""

    shipment = models.OneToOneField('export.Shipment', on_delete=models.PROTECT, related_name='market_lot')
    seller = models.ForeignKey('core.User', on_delete=models.PROTECT, null=True, blank=True, related_name='market_lots')
    boxes_received = models.PositiveIntegerField()
    boxes_per_pallet = models.PositiveIntegerField()
    tare_g = models.PositiveIntegerField(default=450)
    default_price_kg = models.DecimalField(null=True, blank=True, **MONEY)
    currency = models.CharField(max_length=3)
    opened_at = models.DateTimeField(auto_now_add=True)
    opened_by = models.ForeignKey('core.User', on_delete=models.PROTECT, related_name='+')
    # False while the agent has not said how many boxes came (the shipment had no box
    # count, so boxes_received is a placeholder 1). Set True by the agent's receipt.
    receipt_confirmed = models.BooleanField(default=True)
    # Set automatically when nothing is left; cleared when boxes free up (spec §4).
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = schema_table('market', 'lots')
        ordering = ['-opened_at']

    def __str__(self) -> str:
        return f'Lot {self.shipment_id}'


class Buyer(models.Model):
    """A bazaar client of the agent (debt sales need one)."""

    customer = models.ForeignKey('core.Customer', on_delete=models.PROTECT, related_name='market_buyers')
    name = models.CharField(max_length=60, **cyrillic_collation())
    phone = models.CharField(max_length=30, blank=True)

    class Meta:
        db_table = schema_table('market', 'buyers')
        ordering = ['name']
        constraints = [models.UniqueConstraint(fields=['customer', 'name'], name='market_buyer_customer_name_uniq')]

    def __str__(self) -> str:
        return self.name


class Sale(models.Model):
    """One sale off a lot: boxes, scale weight minus tare, price per kg, paid or on debt."""

    UNIT_BOX, UNIT_PALLET, UNIT_TRUCK = 'box', 'pallet', 'truck'
    UNIT_CHOICES = [(UNIT_BOX, 'Box'), (UNIT_PALLET, 'Pallet'), (UNIT_TRUCK, 'Whole truck')]

    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='sales')
    unit = models.CharField(max_length=10, choices=UNIT_CHOICES)
    qty = models.PositiveIntegerField()
    boxes = models.PositiveIntegerField()
    gross_kg = models.DecimalField(**MONEY)
    tare_g = models.PositiveIntegerField()
    net_kg = models.DecimalField(**MONEY)
    price_kg = models.DecimalField(**MONEY)
    calc_total = models.DecimalField(**MONEY)
    total = models.DecimalField(**MONEY)
    paid_on_spot = models.BooleanField(default=True)
    buyer = models.ForeignKey(Buyer, on_delete=models.PROTECT, null=True, blank=True, related_name='sales')
    sold_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('core.User', on_delete=models.PROTECT, related_name='+')

    class Meta:
        db_table = schema_table('market', 'sales')
        ordering = ['-sold_at', '-pk']

    def __str__(self) -> str:
        return f'Sale {self.pk} ({self.boxes} boxes)'


class Spoilage(models.Model):
    """Boxes and/or kg written off without money."""

    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='spoilage')
    boxes = models.PositiveIntegerField(default=0)
    gross_kg = models.DecimalField(null=True, blank=True, **MONEY)
    tare_g = models.PositiveIntegerField()
    net_kg = models.DecimalField(default=0, **MONEY)
    recorded_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('core.User', on_delete=models.PROTECT, related_name='+')

    class Meta:
        db_table = schema_table('market', 'spoilage')
        ordering = ['-recorded_at', '-pk']

    def __str__(self) -> str:
        return f'Spoilage {self.pk}'


class LotExpense(models.Model):
    """A selling cost on a lot (commission, film, parking …); allowed after the lot closes."""

    lot = models.ForeignKey(Lot, on_delete=models.PROTECT, related_name='expenses')
    category = models.ForeignKey('export.ExpenseCategory', on_delete=models.PROTECT, related_name='+')
    label = models.CharField(max_length=40, blank=True, **cyrillic_collation())
    amount = models.DecimalField(**MONEY)
    recorded_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey('core.User', on_delete=models.PROTECT, related_name='+')

    class Meta:
        db_table = schema_table('market', 'lot_expenses')
        ordering = ['-recorded_at', '-pk']

    def __str__(self) -> str:
        return f'Expense {self.pk}'
