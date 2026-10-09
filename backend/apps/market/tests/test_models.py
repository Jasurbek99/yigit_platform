from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.export.models import ExpenseCategory
from apps.market.expense_codes import MARKET_EXPENSES, OTHER_CODE
from apps.market.models import Buyer, Lot, Sale
from apps.market.tests.factories import make_world


class LotModelTests(TestCase):
    """Constraints and constants of the market lot models."""

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()

    def test_one_lot_per_shipment(self):
        Lot.objects.create(shipment=self.w.shipment, boxes_received=100, boxes_per_pallet=50, currency='KZT',
                           opened_by=self.w.agent)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Lot.objects.create(shipment=self.w.shipment, boxes_received=100, boxes_per_pallet=50, currency='KZT',
                               opened_by=self.w.agent)

    def test_buyer_name_unique_per_customer(self):
        Buyer.objects.create(customer=self.w.customer, name='Рустам')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Buyer.objects.create(customer=self.w.customer, name='Рустам')
        Buyer.objects.create(customer=self.w.other_customer, name='Рустам')  # other agent: fine

    def test_sale_units(self):
        self.assertEqual({c for c, _ in Sale.UNIT_CHOICES}, {'box', 'pallet', 'truck'})

    def test_market_expense_categories_exist(self):
        codes = [c for c, _ in MARKET_EXPENSES]
        self.assertEqual(codes[-1], OTHER_CODE)
        for code in codes:
            self.assertTrue(ExpenseCategory.objects.filter(code=code).exists(), code)
