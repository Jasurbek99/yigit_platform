"""Payments vs the caller's scope: only owing sales are locked, scoped payment amounts, paid-off groups stay 30 days."""
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.utils import timezone

from apps.market.models import Payment, PaymentAllocation
from apps.market.services import payments as payments_service
from apps.market.tests.test_entries_api import _as
from apps.market.tests.test_payments_api import DEBTS, _debt_sale, _PaymentCase


class OnlyOwingSalesLockedTests(_PaymentCase):

    def test_paid_off_history_is_not_locked(self):
        # Three older sales already paid in full (allocations one by one: MSSQL Decimal batches).
        old = Payment.objects.create(buyer=self.buyer, currency='KZT', amount=Decimal('7500.00'),
                                     created_by=self.w.agent)
        for sale in (self.sale1, self.sale2, self.sale3):
            PaymentAllocation.objects.create(payment=old, sale=sale, amount=sale.total)
        owing = _debt_sale(self.lot, self.buyer, '800.00', 5)
        with mock.patch.object(payments_service, '_lock_sales', wraps=payments_service._lock_sales) as lock:
            resp = self.pay(self.w.agent, '500')
        self.assertEqual(resp.status_code, 201, resp.content)
        lock.assert_called_once_with([owing.pk])
        new = PaymentAllocation.objects.filter(payment_id=resp.json()['payment']['id'])
        self.assertEqual([(a.sale_id, a.amount) for a in new], [(owing.pk, Decimal('500.00'))])


class ScopedPaymentAmountTests(_PaymentCase):

    def payments(self, user):
        resp = _as(user).get(DEBTS)
        self.assertEqual(resp.status_code, 200, resp.content)
        [group] = resp.json()['buyers']
        return [p['amount'] for p in group['payments']]

    def test_each_sees_his_part_of_the_agents_payment(self):
        self.assertEqual(self.pay(self.w.agent, '7500').status_code, 201)
        self.assertEqual(self.payments(self.w.seller), ['6500.00'])
        self.assertEqual(self.payments(self.w.seller2), ['1000.00'])
        self.assertEqual(self.payments(self.w.agent), ['7500.00'])


class PaidOffGroupTests(_PaymentCase):

    def debts(self, user):
        resp = _as(user).get(DEBTS)
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def test_paid_off_buyer_stays_with_his_payment(self):
        payment_id = self.pay(self.w.seller, '6500').json()['payment']['id']
        body = self.debts(self.w.seller)
        self.assertEqual(body['totals'], {})
        [group] = body['buyers']
        self.assertEqual((group['buyer']['id'], group['currency'], group['due'], group['since'], group['sales']),
                         (self.buyer.pk, 'KZT', '0.00', None, []))
        self.assertEqual([(p['id'], p['amount']) for p in group['payments']], [(payment_id, '6500.00')])
        # The undo is still reachable and gives the debt back.
        self.assertEqual(_as(self.w.seller).delete(f'/api/v1/market/payments/{payment_id}/').status_code, 200)
        self.assertEqual(self.debts(self.w.seller)['totals'], {'KZT': '6500.00'})

    def test_owing_groups_first_paid_off_last(self):
        other = self.buyer.__class__.objects.create(customer=self.w.customer, name='Ержан')
        _debt_sale(self.lot, other, '100.00', 6)
        self.pay(self.w.seller, '6500')
        body = self.debts(self.w.seller)
        self.assertEqual([(g['buyer']['name'], g['due']) for g in body['buyers']],
                         [('Ержан', '100.00'), ('Бакыт', '0.00')])
        self.assertEqual(body['totals'], {'KZT': '100.00'})

    def test_gone_after_30_days(self):
        payment_id = self.pay(self.w.seller, '6500').json()['payment']['id']
        Payment.objects.filter(pk=payment_id).update(paid_at=timezone.now() - timedelta(days=31))
        self.assertEqual(self.debts(self.w.seller), {'totals': {}, 'buyers': []})

    def test_payment_outside_scope_does_not_keep_group(self):
        other = self.buyer.__class__.objects.create(customer=self.w.customer, name='Ержан')
        _debt_sale(self.lot, other, '100.00', 6)
        self.assertEqual(self.pay(self.w.seller, '100', buyer=other).status_code, 201)
        # The seller's paid-off Ержан stays for him; seller2 never had him in scope.
        self.assertIn('Ержан', [g['buyer']['name'] for g in self.debts(self.w.seller)['buyers']])
        self.assertEqual([g['buyer']['name'] for g in self.debts(self.w.seller2)['buyers']], ['Бакыт'])
