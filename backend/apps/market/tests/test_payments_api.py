"""Buyer payments: FIFO over the payer's visible unpaid sales, mark one sale paid, undo, and the debts list."""
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.export.models import AuditLog, SalesReport
from apps.market.models import Buyer, Lot, Payment, PaymentAllocation, Sale
from apps.market.services.dues import sale_due
from apps.market.services.entries import SALE_HAS_PAYMENT
from apps.market.services.payments import NEED_PAY_AMOUNT, NOT_PAYMENT_OWNER, NOTHING_DUE
from apps.market.tests.factories import make_shipment, make_world
from apps.market.tests.test_entries_api import _as

PAYMENTS = '/api/v1/market/payments/'
DEBTS = '/api/v1/market/debts/'


def _debt_sale(lot: Lot, buyer: Buyer, total: str, day: int) -> Sale:
    """A debt sale of `total` on `lot`, sold on 2026-01-`day`."""
    sale = Sale.objects.create(
        lot=lot, unit='box', qty=10, boxes=10, gross_kg=Decimal('104.50'), tare_g=450, net_kg=Decimal('100.00'),
        price_kg=Decimal('45'), calc_total=Decimal(total), total=Decimal(total), paid_on_spot=False, buyer=buyer,
        created_by=lot.seller,
    )
    sold_at = timezone.make_aware(timezone.datetime(2026, 1, day, 10, 0))
    Sale.objects.filter(pk=sale.pk).update(sold_at=sold_at)
    sale.refresh_from_db()
    return sale


class _PaymentCase(TestCase):
    """Buyer B owes 4500 (day 1) and 2000 (day 2) on the seller's lot and 1000 (day 3) on seller2's lot."""

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()
        cls.lot = Lot.objects.create(shipment=cls.w.shipment, seller=cls.w.seller, boxes_received=100,
                                     boxes_per_pallet=50, tare_g=450, currency='KZT', opened_by=cls.w.agent)
        cls.lot2 = Lot.objects.create(shipment=make_shipment(cls.w, 'MK-2', 'bardy'), seller=cls.w.seller2,
                                      boxes_received=100, boxes_per_pallet=50, tare_g=450, currency='KZT',
                                      opened_by=cls.w.agent)
        cls.buyer = Buyer.objects.create(customer=cls.w.customer, name='Бакыт')
        cls.other_buyer = Buyer.objects.create(customer=cls.w.other_customer, name='Чужой')
        cls.sale1 = _debt_sale(cls.lot, cls.buyer, '4500.00', 1)
        cls.sale2 = _debt_sale(cls.lot, cls.buyer, '2000.00', 2)
        cls.sale3 = _debt_sale(cls.lot2, cls.buyer, '1000.00', 3)

    def pay(self, user, amount, currency='KZT', buyer=None):
        body = {'buyer_id': (buyer or self.buyer).pk, 'currency': currency, 'amount': amount}
        return _as(user).post(PAYMENTS, body, format='json')

    def due(self, sale) -> Decimal:
        return sale_due(Sale.objects.get(pk=sale.pk))


class CreatePaymentTests(_PaymentCase):

    def test_seller_pays_oldest_first(self):
        resp = self.pay(self.w.seller, '5000')
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual((body['payment']['amount'], body['payment']['currency']), ('5000.00', 'KZT'))
        self.assertEqual(body['payment']['buyer'], {'id': self.buyer.pk, 'name': 'Бакыт'})
        self.assertEqual(body['debts_total'], {'KZT': '1500.00'})
        allocations = {a.sale_id: a.amount for a in PaymentAllocation.objects.all()}
        self.assertEqual(allocations, {self.sale1.pk: Decimal('4500.00'), self.sale2.pk: Decimal('500.00')})
        self.assertEqual(self.due(self.sale2), Decimal('1500.00'))
        self.assertEqual(self.due(self.sale3), Decimal('1000.00'))
        log = AuditLog.objects.get(model_name='MarketPayment')
        self.assertEqual((log.action, log.object_id), ('create', body['payment']['id']))

    def test_seller_overpays_only_his_scope(self):
        resp = self.pay(self.w.seller, '99999')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['payment']['amount'], '6500.00')
        self.assertEqual(resp.json()['debts_total'], {})
        self.assertEqual(self.due(self.sale3), Decimal('1000.00'))

    def test_agent_covers_all(self):
        resp = self.pay(self.w.agent, '7500')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual([self.due(s) for s in (self.sale1, self.sale2, self.sale3)], [Decimal('0.00')] * 3)
        self.assertEqual(PaymentAllocation.objects.count(), 3)

    def test_other_currency_has_nothing_due(self):
        resp = self.pay(self.w.agent, '1000', currency='RUB')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json(), {'error': NOTHING_DUE})
        self.assertFalse(Payment.objects.exists())

    def test_zero_amount(self):
        resp = self.pay(self.w.seller, '0')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json(), {'amount': [NEED_PAY_AMOUNT]})

    def test_other_customers_buyer(self):
        self.assertEqual(self.pay(self.w.agent, '100', buyer=self.other_buyer).status_code, 404)

    def test_staff_cannot_pay(self):
        self.assertEqual(self.pay(self.w.boss, '100').status_code, 403)
        self.assertEqual(self.pay(self.w.rep, '100').status_code, 403)
        self.assertFalse(Payment.objects.exists())

    def test_allowed_after_report_approval(self):
        SalesReport.objects.create(shipment=self.w.shipment, created_by=self.w.rep, approved_at=timezone.now())
        self.assertEqual(self.pay(self.w.seller, '100').status_code, 201)
        # The approved report still freezes the sales themselves.
        resp = _as(self.w.agent).delete(f'/api/v1/market/lots/{self.lot.pk}/sales/{self.sale2.pk}/')
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(Sale.objects.filter(pk=self.sale2.pk).exists())

    def test_allocated_sale_cannot_be_deleted(self):
        self.assertEqual(self.pay(self.w.seller, '100').status_code, 201)
        resp = _as(self.w.seller).delete(f'/api/v1/market/lots/{self.lot.pk}/sales/{self.sale1.pk}/')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json(), {'error': SALE_HAS_PAYMENT})


class MarkPaidTests(_PaymentCase):

    def url(self, sale):
        return f'/api/v1/market/sales/{sale.pk}/mark-paid/'

    def test_mark_one_sale_paid(self):
        resp = _as(self.w.seller).post(self.url(self.sale2))
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body['payment']['amount'], '2000.00')
        self.assertEqual(body['lot']['id'], self.lot.pk)
        self.assertEqual(body['lot']['totals']['debt_total'], '4500.00')
        self.assertEqual(self.due(self.sale2), Decimal('0.00'))
        self.assertEqual(self.due(self.sale1), Decimal('4500.00'))

    def test_already_paid(self):
        self.assertEqual(_as(self.w.agent).post(self.url(self.sale2)).status_code, 201)
        resp = _as(self.w.agent).post(self.url(self.sale2))
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json(), {'error': NOTHING_DUE})

    def test_other_seller_refused(self):
        self.assertEqual(_as(self.w.seller2).post(self.url(self.sale1)).status_code, 403)
        self.assertEqual(_as(self.w.other_seller).post(self.url(self.sale1)).status_code, 404)
        self.assertFalse(Payment.objects.exists())


class DeletePaymentTests(_PaymentCase):

    def test_author_undoes(self):
        payment_id = self.pay(self.w.seller, '5000').json()['payment']['id']
        resp = _as(self.w.seller).delete(f'{PAYMENTS}{payment_id}/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json(), {'deleted': payment_id})
        self.assertEqual((self.due(self.sale1), self.due(self.sale2)), (Decimal('4500.00'), Decimal('2000.00')))
        self.assertFalse(PaymentAllocation.objects.exists())
        self.assertTrue(AuditLog.objects.filter(model_name='MarketPayment', action='update',
                                                object_id=payment_id).exists())

    def test_another_seller_refused_agent_allowed(self):
        payment_id = self.pay(self.w.seller, '5000').json()['payment']['id']
        resp = _as(self.w.seller2).delete(f'{PAYMENTS}{payment_id}/')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()['error'], NOT_PAYMENT_OWNER)
        self.assertEqual(_as(self.w.other_agent).delete(f'{PAYMENTS}{payment_id}/').status_code, 404)
        self.assertEqual(_as(self.w.agent).delete(f'{PAYMENTS}{payment_id}/').status_code, 200)
        self.assertFalse(Payment.objects.exists())


class DebtsListTests(_PaymentCase):

    def debts(self, user):
        resp = _as(user).get(DEBTS)
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def test_seller_sees_his_sales(self):
        body = self.debts(self.w.seller)
        self.assertEqual(body['totals'], {'KZT': '6500.00'})
        [group] = body['buyers']
        self.assertEqual((group['buyer'], group['currency'], group['due']),
                         ({'id': self.buyer.pk, 'name': 'Бакыт'}, 'KZT', '6500.00'))
        self.assertEqual([s['id'] for s in group['sales']], [self.sale1.pk, self.sale2.pk])
        first = group['sales'][0]
        self.assertEqual((first['lot_id'], first['shipment_code'], first['total'], first['due'], first['boxes']),
                         (self.lot.pk, 'MK-1', '4500.00', '4500.00', 10))
        self.assertEqual(group['since'], first['sold_at'])
        self.assertEqual(group['payments'], [])

    def test_seller2_sees_his(self):
        body = self.debts(self.w.seller2)
        self.assertEqual(body['totals'], {'KZT': '1000.00'})
        self.assertEqual([s['id'] for s in body['buyers'][0]['sales']], [self.sale3.pk])

    def test_agent_sees_all_and_partial_payments(self):
        self.pay(self.w.seller, '5000')
        body = self.debts(self.w.agent)
        self.assertEqual(body['totals'], {'KZT': '2500.00'})
        [group] = body['buyers']
        self.assertEqual([(s['id'], s['due']) for s in group['sales']],
                         [(self.sale2.pk, '1500.00'), (self.sale3.pk, '1000.00')])
        [payment] = group['payments']
        self.assertEqual((payment['amount'], payment['created_by']['id']), ('5000.00', self.w.seller.pk))
        # seller2's scope is not touched by the seller's payment.
        self.assertEqual(self.debts(self.w.seller2)['buyers'][0]['payments'], [])

    def test_groups_by_currency(self):
        rub_lot = Lot.objects.create(shipment=make_shipment(self.w, 'MK-3', 'bardy'), seller=self.w.seller,
                                     boxes_received=10, boxes_per_pallet=10, tare_g=450, currency='RUB',
                                     opened_by=self.w.agent)
        _debt_sale(rub_lot, self.buyer, '300.00', 4)
        body = self.debts(self.w.agent)
        self.assertEqual(body['totals'], {'KZT': '7500.00', 'RUB': '300.00'})
        self.assertEqual([(g['currency'], g['due']) for g in body['buyers']], [('KZT', '7500.00'), ('RUB', '300.00')])

    def test_staff_reads_other_agent_none(self):
        self.assertEqual(self.debts(self.w.boss)['totals'], {'KZT': '7500.00'})
        self.assertEqual(self.debts(self.w.other_agent), {'totals': {}, 'buyers': []})

    def test_since_is_oldest(self):
        Sale.objects.filter(pk=self.sale2.pk).update(sold_at=self.sale1.sold_at - timedelta(days=1))
        group = self.debts(self.w.seller)['buyers'][0]
        self.assertEqual([s['id'] for s in group['sales']], [self.sale2.pk, self.sale1.pk])
