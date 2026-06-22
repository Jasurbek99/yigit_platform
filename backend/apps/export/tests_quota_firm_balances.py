"""Tests for the per-firm quota balance endpoint + service.

Powers the firm-split editor's soft "no quota" warning:
  GET /api/v1/export/quota-firm-balances/?product_type=tomato
  → { "<firm_id>": {issued_kg, used_kg, remaining_kg} }

Coverage:
  - service: issued − approved-used = remaining; draft usage ignored;
    firm with no allocation absent from the map; no active season → {}.
  - endpoint: export_manager 200 with expected shape; seller 403; anon 401.
"""
from datetime import date
from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, Season, User
from apps.export.models import (
    QuotaIssuance,
    QuotaIssuanceFirmAllocation,
    QuotaUsageRecord,
)
from apps.export.services_quota import compute_firm_quota_balances

URL = '/api/v1/export/quota-firm-balances/'


def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _allocate(firm: ExportFirm, kg: str, issue_date=date(2026, 1, 10), product_type='tomato'):
    issuance = QuotaIssuance.objects.create(issue_date=issue_date, product_type=product_type)
    QuotaIssuanceFirmAllocation.objects.create(
        issuance=issuance, export_firm=firm, kg_quota=Decimal(kg),
    )
    return issuance


def _use(firm: ExportFirm, kg: str, status='approved', usage_date=date(2026, 1, 15), product_type='tomato'):
    return QuotaUsageRecord.objects.create(
        usage_date=usage_date, export_firm=firm, kg_used=Decimal(kg),
        product_type=product_type, status=status,
    )


class FirmQuotaBalanceServiceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='qb25', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        cls.has_quota = ExportFirm.objects.create(code='A', name_tk='A', name_en='A')
        cls.used_up = ExportFirm.objects.create(code='B', name_tk='B', name_en='B')
        cls.no_alloc = ExportFirm.objects.create(code='C', name_tk='C', name_en='C')

    def setUp(self):
        cache.clear()

    def test_remaining_is_issued_minus_committed_used(self):
        _allocate(self.has_quota, '10000')
        _use(self.has_quota, '3000')  # approved
        balances = compute_firm_quota_balances('tomato')
        row = balances[self.has_quota.id]
        self.assertEqual(row['issued_kg'], Decimal('10000'))
        self.assertEqual(row['used_kg'], Decimal('3000'))
        self.assertEqual(row['remaining_kg'], Decimal('7000'))

    def test_draft_usage_IS_counted_as_committed(self):
        # Assignment auto-creates DRAFT usage; the warning must reflect it at
        # assignment time, not wait for approval — otherwise it under-warns.
        _allocate(self.has_quota, '5000')
        _use(self.has_quota, '4000', status='draft')
        row = compute_firm_quota_balances('tomato')[self.has_quota.id]
        self.assertEqual(row['used_kg'], Decimal('4000'))
        self.assertEqual(row['remaining_kg'], Decimal('1000'))

    def test_draft_plus_approved_both_count(self):
        _allocate(self.has_quota, '10000')
        _use(self.has_quota, '3000', status='approved')
        _use(self.has_quota, '2000', status='draft')
        row = compute_firm_quota_balances('tomato')[self.has_quota.id]
        self.assertEqual(row['remaining_kg'], Decimal('5000'))

    def test_firm_used_to_zero_has_nonpositive_remaining(self):
        _allocate(self.used_up, '2000')
        _use(self.used_up, '2000')
        row = compute_firm_quota_balances('tomato')[self.used_up.id]
        self.assertEqual(row['remaining_kg'], Decimal('0'))

    def test_firm_without_allocation_is_absent(self):
        _allocate(self.has_quota, '1000')
        balances = compute_firm_quota_balances('tomato')
        self.assertNotIn(self.no_alloc.id, balances)

    def test_no_active_season_returns_empty(self):
        Season.objects.update(is_active=False)
        self.assertEqual(compute_firm_quota_balances('tomato'), {})


class FirmQuotaBalanceEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        Season.objects.create(
            name='qb25', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        firm = ExportFirm.objects.create(code='A', name_tk='A', name_en='A')
        _allocate(firm, '8000')
        _use(firm, '1000')
        cls.firm = firm

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_export_manager_gets_balances(self):
        self.client.force_authenticate(user=_make_user('gadam', 'export_manager'))
        resp = self.client.get(URL, {'product_type': 'tomato'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn(str(self.firm.id), resp.data)
        self.assertEqual(Decimal(str(resp.data[str(self.firm.id)]['remaining_kg'])), Decimal('7000'))

    def test_seller_is_forbidden(self):
        self.client.force_authenticate(user=_make_user('seller1', 'seller'))
        resp = self.client.get(URL, {'product_type': 'tomato'})
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_anonymous_is_unauthorized(self):
        resp = self.client.get(URL, {'product_type': 'tomato'})
        self.assertEqual(resp.status_code, 401, resp.content)
