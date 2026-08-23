"""Tests for the per-firm quota balance endpoint + service.

Powers the firm-split editor's soft "no quota" warning:
  GET /api/v1/export/quota-firm-balances/?product_type=tomato
  → { "<firm_id>": {issued_kg, used_kg, remaining_kg} }

Coverage:
  - service: issued − approved-used = remaining; draft usage ignored;
    firm with no allocation absent from the map; no season → {}.
  - endpoint: export_manager 200 with expected shape; seller 403; anon 401.

D11 (2026-08-06): the service now takes the season explicitly and anchors the
issuance side on `QuotaIssuance.season` rather than an `issue_date` range, so
every fixture issuance here has to be stamped with a season — an unstamped one
belongs to no season and is correctly counted nowhere.
"""
from datetime import date
from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, Season, User
from apps.export.models import (
    QuotaIssuance,
    QuotaIssuanceFirmAllocation,
    QuotaUsageRecord,
)
from apps.export.services_quota import compute_firm_quota_balances

URL = '/api/v1/export/quota-firm-balances/'

# Inside the default fixture issuance's validity window (2026-01-10, this_month
# → live through 2026-01-31). Expiry is the one figure that moves with the
# calendar, so every service test pins it.
PINNED_TODAY = date(2026, 1, 20)


def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _allocate(firm: ExportFirm, kg: str, issue_date=date(2026, 1, 10), product_type='tomato',
              season=None, validity='this_month'):
    issuance = QuotaIssuance.objects.create(
        issue_date=issue_date, product_type=product_type, validity=validity,
        season=season or Season.objects.filter(is_active=True).first(),
    )
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
        balances = compute_firm_quota_balances('tomato', self.season, today=PINNED_TODAY)
        row = balances[self.has_quota.id]
        self.assertEqual(row['issued_kg'], Decimal('10000'))
        self.assertEqual(row['used_kg'], Decimal('3000'))
        self.assertEqual(row['remaining_kg'], Decimal('7000'))

    def test_draft_usage_IS_counted_as_committed(self):
        # Assignment auto-creates DRAFT usage; the warning must reflect it at
        # assignment time, not wait for approval — otherwise it under-warns.
        _allocate(self.has_quota, '5000')
        _use(self.has_quota, '4000', status='draft')
        row = compute_firm_quota_balances('tomato', self.season, today=PINNED_TODAY)[self.has_quota.id]
        self.assertEqual(row['used_kg'], Decimal('4000'))
        self.assertEqual(row['remaining_kg'], Decimal('1000'))

    def test_draft_plus_approved_both_count(self):
        _allocate(self.has_quota, '10000')
        _use(self.has_quota, '3000', status='approved')
        _use(self.has_quota, '2000', status='draft')
        row = compute_firm_quota_balances('tomato', self.season, today=PINNED_TODAY)[self.has_quota.id]
        self.assertEqual(row['remaining_kg'], Decimal('5000'))

    def test_firm_used_to_zero_has_nonpositive_remaining(self):
        _allocate(self.used_up, '2000')
        _use(self.used_up, '2000')
        row = compute_firm_quota_balances('tomato', self.season, today=PINNED_TODAY)[self.used_up.id]
        self.assertEqual(row['remaining_kg'], Decimal('0'))

    def test_firm_without_allocation_is_absent(self):
        _allocate(self.has_quota, '1000')
        balances = compute_firm_quota_balances('tomato', self.season, today=PINNED_TODAY)
        self.assertNotIn(self.no_alloc.id, balances)

    def test_no_season_returns_empty(self):
        """D7 fail-closed, now expressed at the service boundary: the caller
        resolves the season and passes None during the close→open gap."""
        self.assertEqual(compute_firm_quota_balances('tomato', None), {})


class FirmQuotaBalanceEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        Season.objects.create(
            name='qb25', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        firm = ExportFirm.objects.create(code='A', name_tk='A', name_en='A')
        _allocate(firm, '8000', issue_date=timezone.localdate())
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


class FirmQuotaBalanceExpiryTests(TestCase):
    """Expiry (2026-08-23): a lapsed issuance stops counting as quota.

    Before this, the sheet offered ~20 firms as having quota on 2026-08-23 when
    only one held a live allocation — every June leftover still counted.
    """

    @classmethod
    def setUpTestData(cls):
        cls.season = Season.objects.create(
            name='qbx25', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )
        cls.firm = ExportFirm.objects.create(code='X', name_tk='X', name_en='X')

    def setUp(self):
        cache.clear()

    def _balance(self, today):
        return compute_firm_quota_balances('tomato', self.season, today=today).get(self.firm.id)

    def test_lapsed_allocation_leaves_no_remaining(self):
        _allocate(self.firm, '10000', issue_date=date(2026, 1, 10))
        row = self._balance(date(2026, 3, 1))
        self.assertEqual(row['issued_kg'], Decimal('0'))
        self.assertEqual(row['remaining_kg'], Decimal('0'))

    def test_last_valid_day_is_still_live(self):
        # `quota_expiry_date` returns the LAST usable day, and the lapse test is
        # `expiry < today` — so on the expiry date itself the quota still counts.
        _allocate(self.firm, '10000', issue_date=date(2026, 1, 10))
        self.assertEqual(self._balance(date(2026, 1, 31))['remaining_kg'], Decimal('10000'))
        self.assertEqual(self._balance(date(2026, 2, 1))['remaining_kg'], Decimal('0'))

    def test_next_month_validity_expires_end_of_following_month(self):
        _allocate(self.firm, '5000', issue_date=date(2026, 1, 10), validity='next_month')
        self.assertEqual(self._balance(date(2026, 2, 28))['remaining_kg'], Decimal('5000'))
        self.assertEqual(self._balance(date(2026, 3, 1))['remaining_kg'], Decimal('0'))

    def test_usage_is_charged_to_the_lapsed_allocation_first(self):
        # FIFO walks every allocation oldest-first, lapsed included, so the live
        # one reads untouched. Documented in the service docstring, asserted here
        # so the behaviour cannot drift silently.
        _allocate(self.firm, '4000', issue_date=date(2026, 1, 10))
        _allocate(self.firm, '6000', issue_date=date(2026, 3, 5))
        _use(self.firm, '3000', usage_date=date(2026, 3, 10))
        row = self._balance(date(2026, 3, 20))
        self.assertEqual(row['issued_kg'], Decimal('6000'))
        self.assertEqual(row['used_kg'], Decimal('0'))
        self.assertEqual(row['remaining_kg'], Decimal('6000'))

    def test_usage_beyond_the_lapsed_allocation_eats_the_live_one(self):
        _allocate(self.firm, '4000', issue_date=date(2026, 1, 10))
        _allocate(self.firm, '6000', issue_date=date(2026, 3, 5))
        _use(self.firm, '5500', usage_date=date(2026, 3, 10))
        row = self._balance(date(2026, 3, 20))
        self.assertEqual(row['used_kg'], Decimal('1500'))
        self.assertEqual(row['remaining_kg'], Decimal('4500'))

    def test_usage_beyond_every_allocation_floors_at_zero(self):
        # AB on the live DB is over-committed (386,100 used vs 325,000 issued).
        # Per-allocation accounting cannot go negative; <= 0 still blocks.
        _allocate(self.firm, '2000', issue_date=date(2026, 3, 5))
        _use(self.firm, '3000', usage_date=date(2026, 3, 10))
        row = self._balance(date(2026, 3, 20))
        self.assertEqual(row['remaining_kg'], Decimal('0'))

    def test_firm_with_only_lapsed_quota_is_blocked_by_the_gate(self):
        # The gate reads `remaining_kg <= 0` — the firm may still be present in
        # the map (it holds allocations), it just holds nothing live.
        _allocate(self.firm, '10000', issue_date=date(2026, 1, 10))
        row = self._balance(date(2026, 8, 23))
        self.assertLessEqual(row['remaining_kg'], Decimal('0'))
