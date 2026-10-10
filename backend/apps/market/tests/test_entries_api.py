"""Sales, spoilage and expenses on a lot: stock arithmetic, weight / price / debt rules, who may write."""
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.export.models import AuditLog, ExpenseCategory, SalesReport
from apps.market.models import Buyer, Lot, LotExpense, Sale, Spoilage
from apps.market.tests.factories import make_shipment, make_world
from apps.market.text import boxes_ru, plural_ru


def _as(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _box_sale(**extra):
    """10 boxes, 104.50 kg on the scale, 45 per kg → 100.00 kg net, 4500.00."""
    return {'unit': 'box', 'qty': 10, 'gross_kg': '104.50', 'price_kg': '45', 'paid_on_spot': True, **extra}


class _LotCase(TestCase):
    """A lot of 100 boxes (50 per pallet, 450 g tare) assigned to the world's seller."""

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()
        cls.lot = Lot.objects.create(shipment=cls.w.shipment, seller=cls.w.seller, boxes_received=100,
                                     boxes_per_pallet=50, tare_g=450, currency='KZT', opened_by=cls.w.agent)

    def sales_url(self, entry_id=None):
        tail = f'{entry_id}/' if entry_id else ''
        return f'/api/v1/market/lots/{self.lot.pk}/sales/{tail}'

    def sell(self, user=None, **body):
        return _as(user or self.w.seller).post(self.sales_url(), _box_sale(**body), format='json')

    def totals(self):
        return _as(self.w.agent).get(f'/api/v1/market/lots/{self.lot.pk}/').json()['totals']


class PluralTests(TestCase):

    def test_forms(self):
        self.assertEqual([plural_ru(n, 'ящик', 'ящика', 'ящиков') for n in (1, 2, 5, 11, 12, 21, 22, 25, 101)],
                         ['ящик', 'ящика', 'ящиков', 'ящиков', 'ящиков', 'ящик', 'ящика', 'ящиков', 'ящик'])
        self.assertEqual(boxes_ru(90), '90 ящиков')


class SaleCreateTests(_LotCase):

    def test_box_sale(self):
        resp = self.sell()
        self.assertEqual(resp.status_code, 201, resp.content)
        entry, lot = resp.json()['entry'], resp.json()['lot']
        self.assertEqual((entry['boxes'], entry['net_kg'], entry['calc_total'], entry['total']),
                         (10, '100.00', '4500.00', '4500.00'))
        self.assertEqual((lot['totals']['sold_boxes'], lot['totals']['left'], lot['totals']['sales_total']),
                         (10, 90, '4500.00'))

    def test_pallet_sale(self):
        resp = self.sell(unit='pallet', qty=1, gross_kg='520')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['entry']['boxes'], 50)

    def test_pallets_over_whole_pallets_left(self):
        resp = self.sell(unit='pallet', qty=3, gross_kg='1500')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['qty'], ['Больше нельзя: целых паллет осталось 2 (100 ящиков)'])

    def test_pallet_when_less_than_a_pallet_left(self):
        self.assertEqual(self.sell(qty=60, gross_kg='620').status_code, 201)
        resp = self.sell(unit='pallet', qty=1, gross_kg='520')
        self.assertEqual(resp.json()['qty'], ['На целую паллету не хватает. Осталось 40 ящиков.'])

    def test_truck_sale_takes_the_rest_and_closes(self):
        self.assertEqual(self.sell().status_code, 201)
        resp = self.sell(unit='truck', qty=None, gross_kg='950')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual((resp.json()['entry']['boxes'], resp.json()['entry']['qty']), (90, 1))
        self.assertIsNotNone(resp.json()['lot']['closed_at'])
        again = self.sell()
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.json()['error'], 'Машина закрыта. Ящиков не осталось.')
        expense = _as(self.w.seller).post(f'/api/v1/market/lots/{self.lot.pk}/expenses/', {'rows': [
            {'category_id': ExpenseCategory.objects.get(code='KARA').pk, 'amount': '500'}]}, format='json')
        self.assertEqual(expense.status_code, 201, expense.content)

    def test_more_boxes_than_left(self):
        self.assertEqual(self.sell().status_code, 201)
        resp = self.sell(qty=91, gross_kg='1000')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['qty'], ['В машине осталось только 90 ящиков'])

    def test_zero_boxes_refused(self):
        self.assertEqual(self.sell(qty=0).json()['qty'], ['Не меньше 1.'])

    def test_manual_total_kept(self):
        resp = self.sell(total='4510')
        self.assertEqual((resp.json()['entry']['total'], resp.json()['entry']['calc_total']), ('4510.00', '4500.00'))

    def test_weight_and_price_required(self):
        self.assertEqual(self.sell(gross_kg=None).json()['gross_kg'], ['Напишите вес с весов.'])
        self.assertEqual(self.sell(price_kg='0').json()['price_kg'], ['Напишите цену за 1 кг.'])

    def test_net_not_above_tare(self):
        resp = self.sell(gross_kg='4.0')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Вес меньше', resp.json()['gross_kg'][0])
        self.assertEqual(resp.json()['gross_kg'], ['Вес меньше, чем весят пустые ящики (10 ящиков по 450 г).'])

    def test_needs_receipt_refuses_sale(self):
        Lot.objects.filter(pk=self.lot.pk).update(receipt_confirmed=False)
        resp = self.sell()
        self.assertEqual(resp.json()['error'], 'Пусть агент укажет, сколько ящиков пришло.')

    def test_audit_row(self):
        sale_id = self.sell().json()['entry']['id']
        self.assertEqual(AuditLog.objects.filter(model_name='MarketSale', object_id=sale_id, action='create').count(),
                         1)

    def test_first_sale_schedules_status_driving(self):
        with mock.patch('apps.market.services.entries.drive_first_sale') as drive:
            with self.captureOnCommitCallbacks(execute=True):
                self.sell()
            with self.captureOnCommitCallbacks(execute=True):
                self.sell(qty=5, gross_kg='50')
        drive.assert_called_once_with(self.lot.pk, self.w.seller)


class DebtSaleTests(_LotCase):

    def test_debt_needs_buyer(self):
        resp = self.sell(paid_on_spot=False)
        self.assertEqual(resp.json()['buyer_id'], ['Укажите покупателя.'])

    def test_debt_buyer_of_other_customer(self):
        stranger = Buyer.objects.create(customer=self.w.other_customer, name='Чужой')
        resp = self.sell(paid_on_spot=False, buyer_id=stranger.pk)
        self.assertEqual(resp.json()['buyer_id'], ['Покупатель не найден.'])

    def test_debt_with_own_buyer(self):
        buyer = Buyer.objects.create(customer=self.w.customer, name='Свой')
        resp = self.sell(paid_on_spot=False, buyer_id=buyer.pk)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['lot']['totals']['debt_total'], resp.json()['entry']['total'])
        self.assertEqual(resp.json()['entry']['buyer'], {'id': buyer.pk, 'name': 'Свой'})


class WhoWritesTests(_LotCase):

    def test_agent_cannot_sell(self):
        resp = self.sell(user=self.w.agent)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()['error'], 'Продажи записывает продавец этой машины.')

    def test_other_seller_of_same_agent(self):
        self.assertEqual(self.sell(user=self.w.seller2).status_code, 403)

    def test_seller_of_other_agent(self):
        self.assertEqual(self.sell(user=self.w.other_seller).status_code, 404)
        self.assertFalse(Sale.objects.exists())

    def test_staff_cannot_sell(self):
        self.assertEqual(self.sell(user=self.w.boss).status_code, 403)


class DeleteTests(_LotCase):

    def test_delete_closing_sale_reopens(self):
        sale_id = self.sell(unit='truck', gross_kg='1050').json()['entry']['id']
        self.assertIsNotNone(Lot.objects.get(pk=self.lot.pk).closed_at)
        resp = _as(self.w.seller).delete(self.sales_url(sale_id))
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNone(resp.json()['lot']['closed_at'])
        self.assertEqual(resp.json()['lot']['totals']['left'], 100)
        self.assertFalse(Sale.objects.filter(pk=sale_id).exists())
        self.assertEqual(AuditLog.objects.filter(model_name='MarketSale', object_id=sale_id, action='update',
                                                 detail='deleted').count(), 1)

    def test_agent_deletes(self):
        sale_id = self.sell().json()['entry']['id']
        self.assertEqual(_as(self.w.agent).delete(self.sales_url(sale_id)).status_code, 200)

    def test_other_seller_cannot_delete(self):
        sale_id = self.sell().json()['entry']['id']
        self.assertEqual(_as(self.w.seller2).delete(self.sales_url(sale_id)).status_code, 403)
        self.assertTrue(Sale.objects.filter(pk=sale_id).exists())

    def test_reassigned_author_cannot_delete(self):
        sale_id = self.sell().json()['entry']['id']
        Lot.objects.filter(pk=self.lot.pk).update(seller=self.w.seller2)
        # The author is no longer the lot's seller; the new seller is not the author.
        self.assertEqual(_as(self.w.seller).delete(self.sales_url(sale_id)).status_code, 403)
        self.assertEqual(_as(self.w.seller2).delete(self.sales_url(sale_id)).status_code, 403)

    def test_entry_of_another_lot_is_not_found(self):
        sale_id = self.sell().json()['entry']['id']
        other = Lot.objects.create(shipment=make_shipment(self.w, 'MK-2', 'bardy'), seller=self.w.seller, boxes_received=5,
                                   boxes_per_pallet=5, currency='KZT', opened_by=self.w.agent)
        resp = _as(self.w.seller).delete(f'/api/v1/market/lots/{other.pk}/sales/{sale_id}/')
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(Sale.objects.filter(pk=sale_id).exists())


class ApprovedReportTests(_LotCase):

    def test_approved_report_freezes_sales(self):
        sale_id = self.sell().json()['entry']['id']
        SalesReport.objects.create(shipment=self.w.shipment, created_by=self.w.rep, approved_at=timezone.now())
        message = 'Отчёт по машине утверждён — изменить продажи нельзя.'
        self.assertEqual(self.sell().json()['error'], message)
        self.assertEqual(_as(self.w.seller).delete(self.sales_url(sale_id)).json()['error'], message)
        spoil = _as(self.w.seller).post(f'/api/v1/market/lots/{self.lot.pk}/spoilage/', {'boxes': 1}, format='json')
        self.assertEqual(spoil.json()['error'], message)
        expense = _as(self.w.seller).post(f'/api/v1/market/lots/{self.lot.pk}/expenses/', {'rows': [
            {'category_id': ExpenseCategory.objects.get(code='KARA').pk, 'amount': '500'}]}, format='json')
        self.assertEqual(expense.json()['error'], message)

    def test_unapproved_report_does_not_freeze(self):
        SalesReport.objects.create(shipment=self.w.shipment, created_by=self.w.rep)
        self.assertEqual(self.sell().status_code, 201)


class SpoilageTests(_LotCase):

    def url(self, entry_id=None):
        tail = f'{entry_id}/' if entry_id else ''
        return f'/api/v1/market/lots/{self.lot.pk}/spoilage/{tail}'

    def test_nothing_written_off(self):
        resp = _as(self.w.seller).post(self.url(), {'boxes': 0, 'gross_kg': None}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_boxes_and_weight(self):
        resp = _as(self.w.seller).post(self.url(), {'boxes': 3, 'gross_kg': '31.35'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['entry']['net_kg'], '30.00')
        self.assertEqual(resp.json()['lot']['totals']['left'], 97)
        self.assertEqual(AuditLog.objects.filter(model_name='MarketSpoilage', action='create').count(), 1)

    def test_weight_only(self):
        resp = _as(self.w.seller).post(self.url(), {'boxes': 0, 'gross_kg': '5'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual((resp.json()['entry']['net_kg'], resp.json()['lot']['totals']['left']), ('5.00', 100))

    def test_more_than_left(self):
        resp = _as(self.w.seller).post(self.url(), {'boxes': 101}, format='json')
        self.assertEqual(resp.json()['boxes'], ['В машине осталось только 100 ящиков'])

    def test_delete(self):
        entry_id = _as(self.w.seller).post(self.url(), {'boxes': 3}, format='json').json()['entry']['id']
        resp = _as(self.w.agent).delete(self.url(entry_id))
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(Spoilage.objects.exists())


class ExpenseTests(_LotCase):

    def url(self, entry_id=None):
        tail = f'{entry_id}/' if entry_id else ''
        return f'/api/v1/market/lots/{self.lot.pk}/expenses/{tail}'

    def cat(self, code):
        return ExpenseCategory.objects.get(code=code).pk

    def test_batch(self):
        self.sell()
        resp = _as(self.w.seller).post(self.url(), {'rows': [
            {'category_id': self.cat('KARA'), 'amount': '500'},
            {'category_id': self.cat('INTERES'), 'amount': '5000'},
            {'category_id': self.cat('OTHER'), 'amount': '300', 'label': 'Охрана'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(len(resp.json()['entries']), 3)
        totals = resp.json()['lot']['totals']
        self.assertEqual((totals['expenses_total'], totals['after_expenses']), ('5800.00', '-1300.00'))
        self.assertEqual(AuditLog.objects.filter(model_name='MarketExpense', action='create').count(), 3)

    def test_other_needs_label(self):
        resp = _as(self.w.seller).post(self.url(), {'rows': [{'category_id': self.cat('OTHER'), 'amount': '300'}]},
                                       format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(LotExpense.objects.exists())

    def test_bad_rows(self):
        foreign, _ = ExpenseCategory.objects.get_or_create(code='NOT_MARKET', defaults={
            'name_tk': 'x', 'name_ru': 'x', 'name_en': 'x', 'sort_order': 999})
        for rows in ([], [{'category_id': self.cat('KARA'), 'amount': '0'}],
                     [{'category_id': foreign.pk, 'amount': '10'}]):
            self.assertEqual(_as(self.w.seller).post(self.url(), {'rows': rows}, format='json').status_code, 400,
                             rows)
        self.assertFalse(LotExpense.objects.exists())

    def test_inactive_category_refused(self):
        ExpenseCategory.objects.filter(code='KARA').update(is_active=False)
        resp = _as(self.w.seller).post(self.url(), {'rows': [{'category_id': self.cat('KARA'), 'amount': '5'}]},
                                       format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json(), {'category_id': ['Такой статьи расходов нет.']})
        self.assertFalse(LotExpense.objects.exists())

    def test_agent_cannot_add_but_deletes(self):
        self.assertEqual(_as(self.w.agent).post(self.url(), {'rows': [
            {'category_id': self.cat('KARA'), 'amount': '5'}]}, format='json').status_code, 403)
        entry_id = _as(self.w.seller).post(self.url(), {'rows': [
            {'category_id': self.cat('KARA'), 'amount': '5'}]}, format='json').json()['entries'][0]['id']
        self.assertEqual(_as(self.w.agent).delete(self.url(entry_id)).status_code, 200)
        self.assertFalse(LotExpense.objects.exists())
