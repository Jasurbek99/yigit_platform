"""Two sellers' phones selling the last boxes of one truck at the same moment: only one sale is saved.

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

from apps.market.models import Lot, Sale
from apps.market.services import MarketRuleError, create_sale
from apps.market.services import entries as entries_service
from apps.market.tests.factories import make_world

_real_lot_totals = entries_service.lot_totals


def _slow_lot_totals(lot):
    """lot_totals() that holds the transaction open a moment after reading what is left.

    Without the lot lock both threads would read the same `left` inside this
    window and both sales would pass the stock check.
    """
    result = _real_lot_totals(lot)
    time.sleep(0.5)
    return result


class StockRaceTest(TransactionTestCase):
    # NOTE (copied from core/tests/test_idempotency_concurrency.py): no
    # serialized_rollback = True. It replays the serialized snapshot after the
    # flush and collides with the django_content_type rows post_migrate has
    # recreated ("Cannot insert duplicate key row in object
    # 'dbo.django_content_type'"), so the test body never runs.
    #
    # The flush on teardown wipes the seeded statuses and permissions, so the
    # world is built in setUp, not setUpTestData.

    def setUp(self):
        self.w = make_world()
        self.lot = Lot.objects.create(shipment=self.w.shipment, seller=self.w.seller, boxes_received=10,
                                      boxes_per_pallet=10, tare_g=450, currency='KZT', opened_by=self.w.agent)

    def test_two_sales_of_the_last_boxes(self):
        start = threading.Barrier(2, timeout=15)
        saved, refused, crashed = [], [], []

        def sell():
            close_old_connections()
            try:
                start.wait()
                saved.append(create_sale(self.w.seller, self.lot.pk, {
                    'unit': 'box', 'qty': 10, 'gross_kg': Decimal('104.50'), 'price_kg': Decimal('45'),
                    'paid_on_spot': True,
                }))
            except MarketRuleError as exc:
                refused.append(exc.message)
            except Exception as exc:  # noqa: BLE001 — reported by the assertion below
                crashed.append(repr(exc))
            finally:
                # Each thread opens its own connection; teardown would hang otherwise.
                connection.close()

        with mock.patch.object(entries_service, 'lot_totals', _slow_lot_totals):
            threads = [threading.Thread(target=sell) for _ in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

        self.assertEqual(crashed, [])
        self.assertEqual((len(saved), len(refused)), (1, 1), refused)
        # The loser waits for the lock and then finds the truck closed.
        self.assertIn(refused[0], ('Машина закрыта. Ящиков не осталось.', 'В машине осталось только 0 ящиков'))
        self.assertEqual(Sale.objects.filter(lot=self.lot).aggregate(n=Sum('boxes'))['n'], self.lot.boxes_received)
