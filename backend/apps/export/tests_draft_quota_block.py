"""The no-quota firm block on DRAFT creation (`POST /export/shipments/` + is_draft).

`ShipmentViewSet.set_firm_splits` has refused a firm with no remaining quota
since the sheet gate shipped, but draft creation wrote `firm_splits` straight
through — so the destination-draft modal in the Sheet could put exactly the firm
the sheet refuses onto a brand-new truck. These tests pin the hole shut.

Unlike `set_firm_splits` there is no "already on the split" exemption: every
firm on a new draft is newly added.
"""
import datetime
from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, Season, ShipmentStatusType, User
from apps.export.models import QuotaIssuance, QuotaIssuanceFirmAllocation, Shipment

URL = '/api/v1/export/shipments/'


def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class DraftCreateQuotaBlockTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        today = timezone.localdate()
        cls.season = Season.objects.create(
            name='dq26', is_active=True,
            start_date=today - datetime.timedelta(days=60),
            end_date=today + datetime.timedelta(days=180),
        )
        ShipmentStatusType.objects.get_or_create(
            code='draft',
            defaults={'name_tk': 'Garalama', 'name_en': 'Draft', 'step_order': 0, 'phase': 'DRAFT'},
        )
        cls.funded = ExportFirm.objects.create(code='DQF', name_tk='Funded', name_en='Funded')
        cls.dry = ExportFirm.objects.create(code='DQD', name_tk='Dry', name_en='Dry')

        # Live allocation only for `funded`. Issued today with validity
        # 'this_month' so it cannot lapse under the balance service's expiry
        # rule whatever day the suite runs.
        issuance = QuotaIssuance.objects.create(
            issue_date=today, product_type='tomato', validity='this_month',
            season=cls.season,
        )
        QuotaIssuanceFirmAllocation.objects.create(
            issuance=issuance, export_firm=cls.funded, kg_quota=Decimal('50000'),
        )

    def setUp(self):
        cache.clear()  # the balances service caches per season
        self.client = APIClient()
        self.client.force_authenticate(user=_make_user('dq_lead', 'loading_dept_head'))

    def _post(self, firm: ExportFirm | None):
        payload = {'is_draft': True, 'skip_forecast_check': True}
        if firm is not None:
            payload['firm_splits'] = [{'export_firm': firm.pk, 'weight_kg': '10000.00'}]
        return self.client.post(URL, payload, format='json')

    def test_firm_with_quota_is_accepted(self):
        resp = self._post(self.funded)
        self.assertEqual(resp.status_code, 201, resp.data)
        shipment = Shipment.objects.get(pk=resp.data['id'])
        self.assertEqual(shipment.firm_splits.count(), 1)

    def test_firm_without_quota_is_refused(self):
        resp = self._post(self.dry)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('has no remaining quota', resp.data['error'])
        self.assertIn('DQD', resp.data['error'])

    def test_refused_create_leaves_no_shipment_behind(self):
        """The block sits inside the atomic block — the header must roll back too."""
        before = Shipment.objects.count()
        self._post(self.dry)
        self.assertEqual(Shipment.objects.count(), before)

    def test_draft_without_firm_splits_is_unaffected(self):
        """Supply drafts carry blocks and no firms — the gate must not touch them."""
        resp = self._post(None)
        self.assertEqual(resp.status_code, 201, resp.data)
