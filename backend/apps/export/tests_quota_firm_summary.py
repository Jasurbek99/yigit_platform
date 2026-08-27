"""Tests for the per-firm quota SUMMARY endpoint + service.

Answers "which firm holds how much quota right now":
  GET /api/v1/export/quota-firm-summary/?product_type=tomato&season=<id>
  -> [ {export_firm, export_firm_name, issued_kg, used_kg, remaining_kg,
        active_issuance_count, nearest_expiry}, ... ]  sorted remaining desc

`remaining_kg` comes straight from `compute_firm_quota_balances()` — the same
figure the firm-split hard block reads — so the checks here that matter are the
two fields this feature ADDED: `active_issuance_count` and `nearest_expiry`.
`tests_quota_firm_balances.py` is the regression gate for everything else.
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
from apps.export.services_quota import compute_firm_quota_summary

URL = '/api/v1/export/quota-firm-summary/'

# Inside the default fixture issuance's validity window (2026-01-10,
# this_month -> live through 2026-01-31). Expiry is the one figure that moves
# with the calendar, so every service test pins it.
PINNED_TODAY = date(2026, 1, 20)

ROW_KEYS = {
    'export_firm', 'export_firm_name', 'issued_kg', 'used_kg', 'remaining_kg',
    'active_issuance_count', 'nearest_expiry',
}


def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _allocate(firm, kg, issue_date=date(2026, 1, 10), product_type='tomato',
              season=None, validity='this_month'):
    issuance = QuotaIssuance.objects.create(
        issue_date=issue_date, product_type=product_type, validity=validity,
        season=season or Season.objects.filter(is_active=True).first(),
    )
    QuotaIssuanceFirmAllocation.objects.create(
        issuance=issuance, export_firm=firm, kg_quota=Decimal(kg),
    )
    return issuance


def _use(firm, kg, status='approved', usage_date=date(2026, 1, 15), product_type='tomato'):
    return QuotaUsageRecord.objects.create(
        usage_date=usage_date, export_firm=firm, kg_used=Decimal(kg),
        product_type=product_type, status=status,
    )


class FirmQuotaSummaryServiceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='qs25', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        cls.firm_a = ExportFirm.objects.create(code='A', name_tk='A', name_en='Alpha')
        cls.firm_b = ExportFirm.objects.create(code='B', name_tk='B', name_en='Beta')

    def setUp(self):
        cache.clear()

    def _row(self, firm, today=PINNED_TODAY, product_type='tomato'):
        rows = compute_firm_quota_summary(product_type, self.season, today=today)
        return next((r for r in rows if r['export_firm'] == firm.id), None)

    def test_row_carries_firm_id_and_name(self):
        _allocate(self.firm_a, '10000')
        row = self._row(self.firm_a)
        self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual(row['export_firm_name'], 'Alpha')

    def test_active_count_ignores_lapsed_allocations(self):
        _allocate(self.firm_a, '4000', issue_date=date(2026, 1, 10))   # lapsed by March
        _allocate(self.firm_a, '6000', issue_date=date(2026, 3, 5))    # live in March
        row = self._row(self.firm_a, today=date(2026, 3, 20))
        self.assertEqual(row['active_issuance_count'], 1)
        self.assertEqual(row['issued_kg'], Decimal('6000'))

    def test_fully_consumed_live_allocation_is_not_active(self):
        # FIFO empties it, so there is nothing left to spend and nothing worth
        # warning about — count 0 and no expiry, despite the issuance being live.
        _allocate(self.firm_a, '4000')
        _use(self.firm_a, '4000')
        row = self._row(self.firm_a)
        self.assertEqual(row['remaining_kg'], Decimal('0'))
        self.assertEqual(row['active_issuance_count'], 0)
        self.assertIsNone(row['nearest_expiry'])

    def test_nearest_expiry_is_the_earliest_live_allocation(self):
        _allocate(self.firm_a, '3000', issue_date=date(2026, 1, 10), validity='next_month')
        _allocate(self.firm_a, '2000', issue_date=date(2026, 1, 12), validity='this_month')
        row = self._row(self.firm_a)
        self.assertEqual(row['active_issuance_count'], 2)
        self.assertEqual(row['nearest_expiry'], '2026-01-31')

    def test_partially_consumed_allocation_still_counts_and_sets_expiry(self):
        _allocate(self.firm_a, '5000')
        _use(self.firm_a, '2000')
        row = self._row(self.firm_a)
        self.assertEqual(row['active_issuance_count'], 1)
        self.assertEqual(row['remaining_kg'], Decimal('3000'))
        self.assertEqual(row['nearest_expiry'], '2026-01-31')

    def test_firm_with_only_lapsed_quota_still_gets_a_zero_row(self):
        # It must NOT be filtered out: "held quota this season, holds none now"
        # is a different statement from "was never in the quota system".
        _allocate(self.firm_a, '10000', issue_date=date(2026, 1, 10))
        row = self._row(self.firm_a, today=date(2026, 3, 1))
        self.assertEqual(row['issued_kg'], Decimal('0'))
        self.assertEqual(row['remaining_kg'], Decimal('0'))
        self.assertEqual(row['active_issuance_count'], 0)
        self.assertIsNone(row['nearest_expiry'])

    def test_over_committed_firm_is_kept_and_never_negative(self):
        _allocate(self.firm_a, '2000', issue_date=date(2026, 1, 10))
        _use(self.firm_a, '3000')
        row = self._row(self.firm_a)
        self.assertEqual(row['remaining_kg'], Decimal('0'))
        self.assertEqual(row['active_issuance_count'], 0)

    def test_sorted_by_remaining_descending(self):
        _allocate(self.firm_a, '1000')
        _allocate(self.firm_b, '9000')
        rows = compute_firm_quota_summary('tomato', self.season, today=PINNED_TODAY)
        self.assertEqual([r['export_firm'] for r in rows], [self.firm_b.id, self.firm_a.id])

    def test_other_product_type_is_excluded(self):
        _allocate(self.firm_b, '7000', product_type='pepper')
        self.assertIsNone(self._row(self.firm_b, product_type='tomato'))
        self.assertIsNotNone(self._row(self.firm_b, product_type='pepper'))

    def test_no_season_returns_empty_list(self):
        """D7 fail-closed during the close->open gap."""
        self.assertEqual(compute_firm_quota_summary('tomato', None), [])


class FirmQuotaSummaryEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.season = Season.objects.create(
            name='qs25', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        # Open but not active — `resolve_season` serves it to anyone, so the
        # ?season= test asserts scoping and not a closed-season 403.
        cls.other_season = Season.objects.create(
            name='qs24', start_date='2024-09-01', end_date='2025-06-30', is_active=False,
        )
        cls.firm = ExportFirm.objects.create(code='A', name_tk='A', name_en='Alpha')
        cls.other_firm = ExportFirm.objects.create(code='B', name_tk='B', name_en='Beta')
        _allocate(cls.firm, '8000', issue_date=date.today(), validity='this_and_next')
        _allocate(cls.other_firm, '5000', issue_date=date(2024, 10, 1),
                  season=cls.other_season)

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_export_manager_gets_the_active_season_rows(self):
        self.client.force_authenticate(user=_make_user('gadam', 'export_manager'))
        resp = self.client.get(URL, {'product_type': 'tomato'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsInstance(resp.data, list)
        self.assertEqual([r['export_firm'] for r in resp.data], [self.firm.id])
        row = resp.data[0]
        self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual(Decimal(str(row['remaining_kg'])), Decimal('8000'))
        self.assertEqual(row['active_issuance_count'], 1)
        self.assertIsNotNone(row['nearest_expiry'])

    def test_explicit_season_param_scopes_the_rows(self):
        self.client.force_authenticate(user=_make_user('gadam2', 'export_manager'))
        resp = self.client.get(URL, {'product_type': 'tomato', 'season': self.other_season.id})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual([r['export_firm'] for r in resp.data], [self.other_firm.id])

    def test_seller_is_forbidden(self):
        self.client.force_authenticate(user=_make_user('seller1', 'seller'))
        resp = self.client.get(URL, {'product_type': 'tomato'})
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_anonymous_is_unauthorized(self):
        resp = self.client.get(URL, {'product_type': 'tomato'})
        self.assertEqual(resp.status_code, 401, resp.content)
