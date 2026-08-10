"""Quota usage counts immediately — the approval step was removed 2026-08-10.

`status` survives on the model to carry pre-cutover history, but it no longer
records a review: every row is born `'approved'`, and `approved_by` /
`approved_at` stay NULL because nobody signed anything. Read `'approved'` as
"counted".

The case worth pinning hardest is the last one. `sync_draft_quota_usage_for_shipment`
used to refuse (`ApprovedQuotaExistsError` → 400) when approved rows existed on
the shipment, because approved meant a document-team signature automation must
not overwrite. Once every row is born approved that guard fires on every split
edit after the first — it would have 400'd routine work across the whole
platform. Three call sites carried it (`ShipmentViewSet.set_firm_splits` plus two
in `contracts.views`); all three are gone.

Run with:
    python manage.py test apps.export.tests_quota_usage_no_approval --verbosity=2
"""
from datetime import date
from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import Country, ExportFirm, Season, ShipmentStatusType, User
from apps.export.models import QuotaUsageRecord, Shipment, ShipmentFirmSplit
from apps.export.services.quota_sync import sync_draft_quota_usage_for_shipment

URL = '/api/v1/export/quota-usage/'


def _make_status() -> ShipmentStatusType:
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={
            'name_tk': 'Garalama', 'name_en': 'Draft', 'name_ru': 'Черновик',
            'phase': 'DRAFT', 'step_order': 0, 'required_role': 'warehouse_chief',
        },
    )
    return status


class QuotaUsageNoApprovalTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.season = Season.objects.create(
            name='na26', start_date=date(2026, 8, 1), end_date=date(2027, 6, 30),
            is_active=True,
        )
        cls.country = Country.objects.create(code='KZ', name_tk='Gazagystan')
        cls.firm_a = ExportFirm.objects.create(code='NAA', name_tk='Firma NAA')
        cls.firm_b = ExportFirm.objects.create(code='NAB', name_tk='Firma NAB')
        cls.user = User(username='na-gadam', role='export_manager')
        cls.user.set_password('pass')
        cls.user.save()

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _shipment(self, code: str = 'NA-1') -> Shipment:
        return Shipment.objects.create(
            shipment_code=code, date=self.season.start_date, season=self.season,
            status=_make_status(), country=self.country,
        )

    # --- manual rows --------------------------------------------------------

    def test_a_manually_created_row_counts_immediately(self):
        response = self.client.post(URL, {
            'usage_date': '2026-09-01',
            'export_firm': self.firm_a.pk,
            'kg_used': '9000.00',
            'product_type': 'tomato',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.content[:400])
        self.assertEqual(response.json()['status'], 'approved')

    def test_a_client_cannot_ask_for_a_draft(self):
        """`status` is read-only on the serializer AND server-set in perform_create."""
        response = self.client.post(URL, {
            'usage_date': '2026-09-01',
            'export_firm': self.firm_a.pk,
            'kg_used': '9000.00',
            'product_type': 'tomato',
            'status': 'draft',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.content[:400])
        self.assertEqual(QuotaUsageRecord.objects.get(pk=response.json()['id']).status, 'approved')

    def test_nobody_is_recorded_as_the_approver(self):
        """A stamped `approved_by` would be a false signature in the audit trail."""
        response = self.client.post(URL, {
            'usage_date': '2026-09-01',
            'export_firm': self.firm_a.pk,
            'kg_used': '9000.00',
            'product_type': 'tomato',
        }, format='json')
        row = QuotaUsageRecord.objects.get(pk=response.json()['id'])
        self.assertIsNone(row.approved_by_id)
        self.assertIsNone(row.approved_at)
        self.assertEqual(row.created_by_id, self.user.pk)

    def test_an_approved_row_is_still_editable(self):
        """The draft-only edit gate is gone — otherwise nothing would be editable."""
        created = self.client.post(URL, {
            'usage_date': '2026-09-01',
            'export_firm': self.firm_a.pk,
            'kg_used': '9000.00',
            'product_type': 'tomato',
        }, format='json').json()
        response = self.client.patch(
            f"{URL}{created['id']}/", {'kg_used': '7500.00'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.content[:400])
        self.assertEqual(
            QuotaUsageRecord.objects.get(pk=created['id']).kg_used, Decimal('7500.00'),
        )

    def test_an_approved_row_is_still_deletable(self):
        created = self.client.post(URL, {
            'usage_date': '2026-09-01',
            'export_firm': self.firm_a.pk,
            'kg_used': '9000.00',
            'product_type': 'tomato',
        }, format='json').json()
        self.assertEqual(self.client.delete(f"{URL}{created['id']}/").status_code, 204)
        self.assertFalse(QuotaUsageRecord.objects.filter(pk=created['id']).exists())

    def test_the_approve_endpoint_is_gone(self):
        response = self.client.post(f'{URL}approve/', {'ids': [1]}, format='json')
        self.assertIn(response.status_code, (404, 405), response.content[:200])

    # --- auto-generated rows ------------------------------------------------

    def test_sync_creates_rows_that_already_count(self):
        shipment = self._shipment('NA-SYNC')
        ShipmentFirmSplit.objects.create(
            shipment=shipment, export_firm=self.firm_a, weight_kg=Decimal('9000'),
            split_order=1,
        )
        created = sync_draft_quota_usage_for_shipment(shipment, self.user)
        self.assertEqual(created, 1)
        row = shipment.quota_usage_records.get()
        self.assertEqual(row.status, 'approved')
        self.assertIsNone(row.approved_by_id)

    def test_resync_replaces_approved_rows_instead_of_refusing(self):
        """The blocker. This raised ApprovedQuotaExistsError before the cutover."""
        shipment = self._shipment('NA-RESYNC')
        ShipmentFirmSplit.objects.create(
            shipment=shipment, export_firm=self.firm_a, weight_kg=Decimal('9000'),
            split_order=1,
        )
        sync_draft_quota_usage_for_shipment(shipment, self.user)
        self.assertEqual(shipment.quota_usage_records.get().export_firm_id, self.firm_a.pk)

        # Operator changes their mind: firm_b rides the truck instead.
        shipment.firm_splits.all().delete()
        ShipmentFirmSplit.objects.create(
            shipment=shipment, export_firm=self.firm_b, weight_kg=Decimal('8000'),
            split_order=1,
        )
        sync_draft_quota_usage_for_shipment(shipment, self.user)

        rows = list(shipment.quota_usage_records.all())
        self.assertEqual(len(rows), 1, 'the old approved row must be replaced, not kept')
        self.assertEqual(rows[0].export_firm_id, self.firm_b.pk)
        self.assertEqual(rows[0].kg_used, Decimal('8000.00'))

    def test_removing_every_split_clears_the_usage(self):
        shipment = self._shipment('NA-EMPTY')
        ShipmentFirmSplit.objects.create(
            shipment=shipment, export_firm=self.firm_a, weight_kg=Decimal('9000'),
            split_order=1,
        )
        sync_draft_quota_usage_for_shipment(shipment, self.user)
        shipment.firm_splits.all().delete()

        self.assertEqual(sync_draft_quota_usage_for_shipment(shipment, self.user), 0)
        self.assertEqual(shipment.quota_usage_records.count(), 0)
