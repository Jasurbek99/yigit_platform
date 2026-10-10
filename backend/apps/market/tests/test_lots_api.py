"""Lots API: open / claim by seller / agent receipt PATCH / lists, plus the reference lists."""
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.export.models import ExpenseCategory
from apps.market.models import Lot, LotExpense, Sale
from apps.market.tests.factories import make_shipment, make_world


def _as(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _sale(lot, boxes, user, paid=True):
    """A plain box sale of `boxes` boxes at 10 per kg (9.55 kg net per box)."""
    net = Decimal('9.55') * boxes
    return Sale.objects.create(lot=lot, unit='box', qty=boxes, boxes=boxes, gross_kg=Decimal('10') * boxes,
                               tare_g=450, net_kg=net, price_kg=Decimal('10'), calc_total=net * 10,
                               total=net * 10, paid_on_spot=paid, created_by=user)


class OpenLotTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()

    def test_agent_opens_lot_with_shipment_defaults(self):
        resp = _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body['boxes_received'], 100)
        self.assertEqual(body['boxes_per_pallet'], 50)
        self.assertEqual(body['currency'], 'KZT')
        self.assertIsNone(body['seller'])
        self.assertFalse(body['needs_receipt'])

    def test_open_twice_returns_same_lot(self):
        a = _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        b = _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(a.json()['id'], b.json()['id'])
        self.assertEqual(b.status_code, 200)
        self.assertEqual(Lot.objects.count(), 1)

    def _open_bare(self):
        bare = make_shipment(self.w, 'MK-NB', 'bardy')
        bare.box_count = None
        bare.save(update_fields=['box_count'])
        return _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': bare.pk}, format='json').json()

    def test_missing_box_count_needs_receipt(self):
        body = self._open_bare()
        self.assertEqual((body['boxes_received'], body['boxes_per_pallet'], body['needs_receipt']), (1, 1, True))

    def test_expense_keeps_needs_receipt(self):
        lot = Lot.objects.get(pk=self._open_bare()['id'])
        LotExpense.objects.create(lot=lot, category=ExpenseCategory.objects.get(code='KARA'), amount=Decimal('50'),
                                  created_by=self.w.agent)
        self.assertTrue(_as(self.w.agent).get(f'/api/v1/market/lots/{lot.pk}/').json()['needs_receipt'])

    def test_agent_receipt_clears_needs_receipt(self):
        lot_id = self._open_bare()['id']
        resp = _as(self.w.agent).patch(f'/api/v1/market/lots/{lot_id}/', {'boxes_received': 1}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(resp.json()['needs_receipt'])
        self.assertTrue(Lot.objects.get(pk=lot_id).receipt_confirmed)

    def _open_with_pallets(self, code, pallets):
        shipment = make_shipment(self.w, code, 'bardy')
        shipment.pallet_count = pallets
        shipment.save(update_fields=['pallet_count'])
        return _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': shipment.pk}, format='json').json()

    def test_missing_pallet_count_needs_receipt(self):
        for code, pallets in (('MK-NP', None), ('MK-ZP', 0)):
            body = self._open_with_pallets(code, pallets)
            self.assertEqual((body['boxes_received'], body['boxes_per_pallet'], body['needs_receipt']),
                             (100, 1, True), pallets)

    def test_boxes_per_pallet_patch_confirms_receipt(self):
        lot_id = self._open_with_pallets('MK-NP', None)['id']
        resp = _as(self.w.agent).patch(f'/api/v1/market/lots/{lot_id}/', {'boxes_per_pallet': 1}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(resp.json()['needs_receipt'])
        self.assertTrue(Lot.objects.get(pk=lot_id).receipt_confirmed)

    def test_more_pallets_than_boxes_opens_with_one_per_pallet(self):
        body = self._open_with_pallets('MK-MP', 200)
        self.assertEqual((body['boxes_per_pallet'], body['needs_receipt']), (1, False))

    def test_claim_refused_after_agent_assigned_seller(self):
        lot_id = _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk},
                                        format='json').json()['id']
        _as(self.w.agent).patch(f'/api/v1/market/lots/{lot_id}/', {'seller_id': self.w.seller2.pk}, format='json')
        resp = _as(self.w.seller).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Lot.objects.get(pk=lot_id).seller_id, self.w.seller2.pk)

    def test_seller_claims_unassigned_lot(self):
        resp = _as(self.w.seller).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertIn(resp.status_code, (200, 201))
        self.assertEqual(Lot.objects.get().seller, self.w.seller)

    def test_second_seller_refused(self):
        _as(self.w.seller).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        resp = _as(self.w.seller2).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()['error'], 'Машина назначена другому продавцу.')

    def test_other_customer_gets_404(self):
        resp = _as(self.w.other_seller).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_draft_shipment_not_openable(self):
        draft = make_shipment(self.w, 'MK-D', 'draft')
        resp = _as(self.w.agent).post('/api/v1/market/lots/open/', {'shipment_id': draft.pk}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_refusal_under_idempotency_key_is_not_a_500(self):
        # A raised refusal must reach @idempotent as a 403 response (key freed), not as a 500 it replays.
        _as(self.w.seller).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        c = _as(self.w.seller2)
        for _ in range(2):
            resp = c.post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json',
                          HTTP_IDEMPOTENCY_KEY='retry-key-0001')
            self.assertEqual(resp.status_code, 403, resp.content)

    def test_open_replays_under_idempotency_key(self):
        c = _as(self.w.agent)
        a = c.post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json',
                   HTTP_IDEMPOTENCY_KEY='open-key-0001')
        b = c.post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json',
                   HTTP_IDEMPOTENCY_KEY='open-key-0001')
        self.assertEqual((a.status_code, b.status_code, a.json()['id']), (201, 201, b.json()['id']))

    def test_staff_cannot_open(self):
        resp = _as(self.w.boss).post('/api/v1/market/lots/open/', {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 403)


class LotListAndPatchTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()
        cls.lot = Lot.objects.create(shipment=cls.w.shipment, seller=cls.w.seller, boxes_received=100,
                                     boxes_per_pallet=50, currency='KZT', opened_by=cls.w.agent)

    def test_seller_sees_only_own_lots(self):
        other = make_shipment(self.w, 'MK-2', 'bardy')
        Lot.objects.create(shipment=other, seller=self.w.seller2, boxes_received=10, boxes_per_pallet=5,
                           currency='KZT', opened_by=self.w.agent)
        ids = [r['id'] for r in _as(self.w.seller).get('/api/v1/market/lots/').json()['results']]
        self.assertEqual(ids, [self.lot.pk])
        self.assertEqual(_as(self.w.seller).get(f'/api/v1/market/lots/{other.market_lot.pk}/').status_code, 404)

    def test_other_agent_404(self):
        self.assertEqual(_as(self.w.other_agent).get(f'/api/v1/market/lots/{self.lot.pk}/').status_code, 404)

    def test_rep_reads_own_customer_lot(self):
        self.assertEqual(_as(self.w.rep).get(f'/api/v1/market/lots/{self.lot.pk}/').status_code, 200)

    def test_detail_shape_and_totals(self):
        _sale(self.lot, 10, self.w.seller, paid=False)
        body = _as(self.w.agent).get(f'/api/v1/market/lots/{self.lot.pk}/').json()
        self.assertEqual(body['shipment']['code'], 'MK-1')
        self.assertEqual(body['seller']['id'], self.w.seller.pk)
        self.assertEqual(len(body['sales']), 1)
        self.assertEqual((body['spoilage'], body['expenses']), ([], []))
        t = body['totals']
        self.assertEqual((t['sold_boxes'], t['used'], t['left']), (10, 10, 90))
        self.assertEqual((t['sold_kg'], t['sales_total'], t['debt_total']), ('95.50', '955.00', '955.00'))
        self.assertEqual((t['paid_total'], t['avg_price_kg']), ('0.00', '10.00'))

    def test_state_filter(self):
        self.assertEqual(_as(self.w.agent).get('/api/v1/market/lots/?state=closed').json()['results'], [])
        rows = _as(self.w.agent).get('/api/v1/market/lots/?state=open').json()['results']
        self.assertEqual([r['id'] for r in rows], [self.lot.pk])

    def test_agent_patch_receipt_and_seller(self):
        resp = _as(self.w.agent).patch(f'/api/v1/market/lots/{self.lot.pk}/',
                                       {'boxes_received': 120, 'seller_id': self.w.seller2.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.lot.refresh_from_db()
        self.assertEqual((self.lot.boxes_received, self.lot.seller_id), (120, self.w.seller2.pk))

    def test_patch_seller_of_other_customer_400(self):
        resp = _as(self.w.agent).patch(f'/api/v1/market/lots/{self.lot.pk}/', {'seller_id': self.w.other_seller.pk},
                                       format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('seller_id', resp.json())

    def test_seller_cannot_patch_lot(self):
        resp = _as(self.w.seller).patch(f'/api/v1/market/lots/{self.lot.pk}/', {'boxes_received': 5}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_boxes_received_not_below_used(self):
        _sale(self.lot, 60, self.w.seller)
        resp = _as(self.w.agent).patch(f'/api/v1/market/lots/{self.lot.pk}/', {'boxes_received': 50}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('60', resp.json()['error'])

    def test_receipt_equal_to_used_closes_lot(self):
        _sale(self.lot, 60, self.w.seller)
        resp = _as(self.w.agent).patch(f'/api/v1/market/lots/{self.lot.pk}/', {'boxes_received': 60}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNotNone(resp.json()['closed_at'])

    def test_on_the_road_flag(self):
        self.assertFalse(_as(self.w.seller).get(f'/api/v1/market/lots/{self.lot.pk}/').json()['on_the_road'])
        road = make_shipment(self.w, 'MK-R', 'dest_entry')
        lot = Lot.objects.create(shipment=road, seller=self.w.seller, boxes_received=10, boxes_per_pallet=5,
                                 currency='KZT', opened_by=self.w.agent)
        self.assertTrue(_as(self.w.seller).get(f'/api/v1/market/lots/{lot.pk}/').json()['on_the_road'])
        rows = {r['id']: r['on_the_road'] for r in _as(self.w.seller).get('/api/v1/market/lots/').json()['results']}
        self.assertEqual(rows, {self.lot.pk: False, lot.pk: True})

    def test_delete_lot_view_only_403_then_405(self):
        # Permissions run before the method lookup: view-only staff are refused first.
        self.assertEqual(_as(self.w.rep).delete(f'/api/v1/market/lots/{self.lot.pk}/').status_code, 403)
        self.assertEqual(_as(self.w.agent).delete(f'/api/v1/market/lots/{self.lot.pk}/').status_code, 405)

    def test_lists_are_not_season_scoped(self):
        # Season.is_closed is a property: closed = closed_at set (and inactive, as close_season() writes).
        self.w.season.closed_at = timezone.now()
        self.w.season.is_active = False
        self.w.season.save()
        ids = [r['id'] for r in _as(self.w.seller).get('/api/v1/market/lots/').json()['results']]
        self.assertEqual(ids, [self.lot.pk])


class ReferenceListsTests(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.w = make_world()

    def test_expense_categories_in_market_order(self):
        rows = _as(self.w.seller).get('/api/v1/market/expense-categories/').json()
        self.assertEqual([r['label'] for r in rows], ['Кара', 'Комиссия', 'Плёнка', 'Заезд', 'Парковка', 'Простой', 'Другое'])

    def test_buyers_get_or_create_case_insensitive(self):
        a = _as(self.w.seller).post('/api/v1/market/buyers/', {'name': 'Рустам'}, format='json').json()
        b = _as(self.w.agent).post('/api/v1/market/buyers/', {'name': 'рустам'}, format='json').json()
        self.assertEqual(a['id'], b['id'])
        found = _as(self.w.seller).get('/api/v1/market/buyers/?q=рус').json()
        self.assertEqual([r['name'] for r in found], ['Рустам'])
        self.assertEqual(_as(self.w.other_seller).get('/api/v1/market/buyers/?q=рус').json(), [])

    def test_available_shipments_for_agent(self):
        rows = _as(self.w.agent).get('/api/v1/market/shipments/').json()
        self.assertEqual([r['code'] for r in rows], ['MK-1'])
        self.assertIsNone(rows[0]['lot_id'])
        self.assertEqual(_as(self.w.seller).get('/api/v1/market/shipments/').status_code, 403)
