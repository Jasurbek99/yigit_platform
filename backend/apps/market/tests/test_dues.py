"""Derived due of a sale: allocations reduce it, totals and the sale payload follow, an allocated sale can't go."""
from decimal import Decimal

from apps.market.models import Buyer, Payment, PaymentAllocation, Sale
from apps.market.services.dues import debt_sales, sale_due, sale_paid
from apps.market.services.totals import lot_totals
from apps.market.tests.test_entries_api import _as, _LotCase

PAID_SALE = 'По этой продаже уже есть оплата — сначала отмените оплату.'


class _DebtCase(_LotCase):
    """One spot sale (4500) and one debt sale (4500) on the lot; the debt sale has 1000 + 500 allocated."""

    def setUp(self):
        self.buyer = Buyer.objects.create(customer=self.w.customer, name='Ерлан')
        spot = self.sell()
        self.assertEqual(spot.status_code, 201, spot.content)
        debt = self.sell(paid_on_spot=False, buyer_id=self.buyer.pk)
        self.assertEqual(debt.status_code, 201, debt.content)
        self.spot_sale = Sale.objects.get(pk=spot.json()['entry']['id'])
        self.debt_sale = Sale.objects.get(pk=debt.json()['entry']['id'])

    def allocate(self, *amounts, sale=None):
        """One payment of the buyer per amount, each allocated in full to `sale` (default: the debt sale)."""
        for amount in amounts:  # one by one: no bulk_create on MSSQL Decimal batches
            payment = Payment.objects.create(buyer=self.buyer, currency='KZT', amount=Decimal(amount),
                                             created_by=self.w.seller)
            PaymentAllocation.objects.create(payment=payment, sale=sale or self.debt_sale, amount=Decimal(amount))


class SaleDueTests(_DebtCase):

    def test_debt_sale_due_and_paid(self):
        self.allocate('1000', '500')
        self.assertEqual(sale_due(self.debt_sale), Decimal('3000.00'))
        self.assertEqual(sale_paid(self.debt_sale), Decimal('1500.00'))

    def test_unallocated_debt_sale(self):
        self.assertEqual(str(sale_due(self.debt_sale)), '4500.00')
        self.assertEqual(str(sale_paid(self.debt_sale)), '0.00')

    def test_paid_on_spot_owes_nothing(self):
        self.assertEqual(str(sale_due(self.spot_sale)), '0.00')
        self.assertEqual(sale_paid(self.spot_sale), Decimal('4500.00'))

    def test_debt_sales_keeps_only_unpaid_debt(self):
        full = self.sell(paid_on_spot=False, buyer_id=self.buyer.pk)
        full_sale = Sale.objects.get(pk=full.json()['entry']['id'])
        self.allocate('1000')
        self.allocate('4500', sale=full_sale)
        self.assertEqual(list(debt_sales(self.lot.sales.all()).values_list('pk', flat=True)), [self.debt_sale.pk])


class LotTotalsTests(_DebtCase):

    def test_paid_and_debt_follow_allocations(self):
        self.allocate('1000', '500')
        totals = lot_totals(self.lot)
        self.assertEqual((totals['sales_total'], totals['paid_total'], totals['debt_total']),
                         (Decimal('9000.00'), Decimal('6000.00'), Decimal('3000.00')))

    def test_detail_payload(self):
        self.allocate('1000', '500')
        body = _as(self.w.agent).get(f'/api/v1/market/lots/{self.lot.pk}/').json()
        sales = {s['id']: s for s in body['sales']}
        self.assertEqual((sales[self.debt_sale.pk]['due'], sales[self.debt_sale.pk]['paid_amount']),
                         ('3000.00', '1500.00'))
        self.assertEqual((sales[self.spot_sale.pk]['due'], sales[self.spot_sale.pk]['paid_amount']),
                         ('0.00', '4500.00'))
        self.assertEqual((body['totals']['paid_total'], body['totals']['debt_total']), ('6000.00', '3000.00'))


class AllocatedSaleDeleteTests(_DebtCase):

    def test_allocated_sale_is_kept(self):
        self.allocate('1000')
        resp = _as(self.w.seller).delete(self.sales_url(self.debt_sale.pk))
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json()['error'], PAID_SALE)
        self.assertTrue(Sale.objects.filter(pk=self.debt_sale.pk).exists())

    def test_unallocated_debt_sale_deletes(self):
        resp = _as(self.w.seller).delete(self.sales_url(self.debt_sale.pk))
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(Sale.objects.filter(pk=self.debt_sale.pk).exists())
