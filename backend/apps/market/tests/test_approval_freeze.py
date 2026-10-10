"""An approved sales report freezes the whole lot: sales, spoilage, expenses and the agent's receipt."""
from django.utils import timezone

from apps.export.models import ExpenseCategory, SalesReport
from apps.market.models import Lot, LotExpense
from apps.market.services.lots import REPORT_APPROVED
from apps.market.tests.test_entries_api import _as, _LotCase


class ApprovalFreezeTests(_LotCase):

    def lot_url(self):
        return f'/api/v1/market/lots/{self.lot.pk}/'

    def expenses_url(self, entry_id=None):
        tail = f'{entry_id}/' if entry_id else ''
        return f'{self.lot_url()}expenses/{tail}'

    def add_expense(self):
        return _as(self.w.seller).post(self.expenses_url(), {'rows': [
            {'category_id': ExpenseCategory.objects.get(code='KARA').pk, 'amount': '500'}]}, format='json')

    def approve(self):
        SalesReport.objects.create(shipment=self.w.shipment, created_by=self.w.rep, approved_at=timezone.now())

    def test_expense_create_refused_after_approval(self):
        self.approve()
        resp = self.add_expense()
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json(), {'error': REPORT_APPROVED})
        self.assertFalse(LotExpense.objects.filter(lot=self.lot).exists())

    def test_expense_delete_refused_after_approval(self):
        expense_id = self.add_expense().json()['entries'][0]['id']
        self.approve()
        resp = _as(self.w.seller).delete(self.expenses_url(expense_id))
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json(), {'error': REPORT_APPROVED})
        self.assertTrue(LotExpense.objects.filter(pk=expense_id).exists())

    def test_receipt_edit_refused_after_approval(self):
        self.approve()
        resp = _as(self.w.agent).patch(self.lot_url(), {'boxes_received': 90}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json(), {'error': REPORT_APPROVED})
        self.lot.refresh_from_db()
        self.assertEqual(self.lot.boxes_received, 100)

    def test_seller_change_refused_after_approval(self):
        self.approve()
        resp = _as(self.w.agent).patch(self.lot_url(), {'seller_id': self.w.seller2.pk}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json(), {'error': REPORT_APPROVED})
        self.lot.refresh_from_db()
        self.assertEqual(self.lot.seller_id, self.w.seller.pk)

    def test_without_approval_expense_and_receipt_work(self):
        SalesReport.objects.create(shipment=self.w.shipment, created_by=self.w.rep)
        self.assertEqual(self.add_expense().status_code, 201)
        resp = _as(self.w.agent).patch(self.lot_url(), {'boxes_received': 90}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_sale_and_spoilage_still_refused(self):
        self.approve()
        self.assertEqual(self.sell().json(), {'error': REPORT_APPROVED})
        spoil = _as(self.w.seller).post(f'{self.lot_url()}spoilage/', {'boxes': 1}, format='json')
        self.assertEqual(spoil.json(), {'error': REPORT_APPROVED})


class ClaimAfterApprovalTests(_LotCase):
    """The seller is frozen once the report is approved: a QR scan no longer claims the lot."""

    def open_url(self):
        return '/api/v1/market/lots/open/'

    def approve(self):
        SalesReport.objects.create(shipment=self.w.shipment, created_by=self.w.rep, approved_at=timezone.now())

    def test_unassigned_lot_not_claimed(self):
        Lot.objects.filter(pk=self.lot.pk).update(seller=None)
        self.approve()
        resp = _as(self.w.seller2).post(self.open_url(), {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json(), {'error': REPORT_APPROVED})
        self.lot.refresh_from_db()
        self.assertIsNone(self.lot.seller_id)

    def test_own_lot_still_opens(self):
        self.approve()
        resp = _as(self.w.seller).post(self.open_url(), {'shipment_id': self.w.shipment.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['seller']['id'], self.w.seller.pk)
