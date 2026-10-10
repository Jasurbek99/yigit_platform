"""Two phones paying the same buyer's debt at the same moment: the sales are never over-paid.

TransactionTestCase is required: TestCase wraps each test in a transaction the
worker threads cannot see into, so their row locks would never meet.
"""
import threading
import time
from decimal import Decimal
from unittest import mock

from django.db import close_old_connections, connection
from django.db.models import Sum
from django.test import TransactionTestCase

from apps.market.models import Buyer, Lot, PaymentAllocation, Sale
from apps.market.services import payments as payments_service
from apps.market.services.dues import sale_due
from apps.market.services.payments import create_payment
from apps.market.tests.factories import make_world
from apps.market.tests.test_payments_api import _debt_sale

_real_locked_dues = payments_service._locked_dues


def _slow_locked_dues(sale_ids):
    """_locked_dues() that holds the transaction open after reading the dues.

    Without the buyer lock both payments would read the same 6500 inside this
    window and allocate 4000 each.
    """
    result = _real_locked_dues(sale_ids)
    time.sleep(0.5)
    return result


class PaymentRaceTest(TransactionTestCase):
    # No serialized_rollback (see test_stock_race.py); the world is built in setUp.

    def setUp(self):
        self.w = make_world()
        lot = Lot.objects.create(shipment=self.w.shipment, seller=self.w.seller, boxes_received=100,
                                 boxes_per_pallet=50, tare_g=450, currency='KZT', opened_by=self.w.agent)
        self.buyer = Buyer.objects.create(customer=self.w.customer, name='Бакыт')
        self.sales = [_debt_sale(lot, self.buyer, '4500.00', 1), _debt_sale(lot, self.buyer, '2000.00', 2)]

    def test_two_payments_of_one_debt(self):
        start = threading.Barrier(2, timeout=15)
        saved, crashed = [], []

        def pay(user):
            close_old_connections()
            try:
                start.wait()
                saved.append(create_payment(user, self.buyer.pk, 'KZT', Decimal('4000')))
            except Exception as exc:  # noqa: BLE001 — reported by the assertion below
                crashed.append(repr(exc))
            finally:
                connection.close()

        with mock.patch.object(payments_service, '_locked_dues', _slow_locked_dues):
            threads = [threading.Thread(target=pay, args=(u,)) for u in (self.w.seller, self.w.agent)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

        self.assertEqual(crashed, [])
        # The second payer waits for the buyer lock, then finds 2500 left.
        self.assertEqual(sorted(p.amount for p in saved), [Decimal('2500.00'), Decimal('4000.00')])
        self.assertEqual(PaymentAllocation.objects.aggregate(s=Sum('amount'))['s'], Decimal('6500.00'))
        for sale in self.sales:
            self.assertEqual(sale_due(Sale.objects.get(pk=sale.pk)), Decimal('0.00'))
