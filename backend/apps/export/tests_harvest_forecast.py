"""Tests for the harvest-forecast pool feature.

Coverage:
  1. get_remaining_for_date — forecast − allocated; multiple drafts draw down;
     never negative; cancelled shipments are excluded.
  2. get_remaining_for_block — single-block helper.
  3. POST /api/v1/export/harvest-forecast/ — upsert creates/updates
     HarvestDayEntry.forecast_value; notification created; role gate.
  4. GET  /api/v1/export/harvest-forecast/remaining/?date= — response shape.
  5. Draft-create validation — rejects draw over remaining; rejects draw
     over 18,500 kg; happy path within remaining succeeds.

Run:
    python manage.py test apps.export.tests_harvest_forecast --keepdb --noinput
"""
import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    GreenhouseBlock,
    GreenhouseConfig,
    Season,
    ShipmentStatusType,
    User,
)
from apps.export.models import Notification, Shipment, ShipmentBlockSource
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_user(username: str, role: str) -> User:
    return User.objects.create_user(username=username, password='pw', role=role)


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='FC-2026',
        defaults={
            'start_date': '2026-01-01',
            'end_date': '2026-12-31',
            'is_active': True,
        },
    )
    return season


def _make_status(code: str, step_order: int, name_en: str, phase: str = 'LOADING') -> ShipmentStatusType:
    obj, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': name_en, 'name_ru': name_en,
            'step_order': step_order, 'phase': phase,
        },
    )
    return obj


def _make_plan_and_entry(
    season: Season,
    block: GreenhouseBlock,
    target_date: datetime.date,
    forecast_kg: Decimal | None = None,
) -> HarvestDayEntry:
    """Create WeeklyHarvestPlan + HarvestDayEntry for a given (block, date)."""
    iso_year, iso_week, _ = target_date.isocalendar()
    weekday = target_date.weekday()
    plan, _ = WeeklyHarvestPlan.objects.get_or_create(
        season=season,
        block=block,
        week_number=iso_week,
        year=iso_year,
    )
    entry, _ = HarvestDayEntry.objects.get_or_create(
        weekly_plan=plan,
        entry_date=target_date,
        defaults={'season': season, 'block': block, 'weekday': weekday},
    )
    if forecast_kg is not None:
        entry.forecast_value = forecast_kg
        entry.save(update_fields=['forecast_value'])
    return entry


def _make_shipment(
    cargo_code: str,
    date: datetime.date,
    season: Season,
    status: ShipmentStatusType,
    block: GreenhouseBlock,
    weight_kg: Decimal,
) -> Shipment:
    """Create a shipment with one block source row."""
    s = Shipment.objects.create(
        cargo_code=cargo_code,
        date=date,
        season=season,
        status=status,
    )
    ShipmentBlockSource.objects.create(shipment=s, block=block, weight_kg=weight_kg)
    return s


# ---------------------------------------------------------------------------
# Tests: get_remaining_for_date
# ---------------------------------------------------------------------------

class GetRemainingForDateTests(TestCase):
    """Unit tests for the remaining-pool computation service."""

    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()  # ensure singleton exists

        cls.season = _make_season()
        cls.block_a, _ = GreenhouseBlock.objects.get_or_create(
            code='FC-A', defaults={'name': 'FC Block A', 'is_active': True},
        )
        cls.block_b, _ = GreenhouseBlock.objects.get_or_create(
            code='FC-B', defaults={'name': 'FC Block B', 'is_active': True},
        )
        cls.draft_status = _make_status('draft', 0, 'Draft')
        cls.cancelled_status = _make_status('cancelled', 99, 'Cancelled', phase='CANCELLED')

        cls.target_date = datetime.date(2026, 6, 1)  # Monday

    def test_remaining_equals_forecast_when_no_drafts(self):
        """With no allocated drafts, remaining == forecast."""
        from apps.export.services.harvest_forecast import get_remaining_for_date

        _make_plan_and_entry(self.season, self.block_a, self.target_date, Decimal('40000'))

        rows = get_remaining_for_date(self.target_date)
        block_a_row = next(r for r in rows if r['block_id'] == self.block_a.id)

        self.assertEqual(block_a_row['forecast_kg'], Decimal('40000'))
        self.assertEqual(block_a_row['allocated_kg'], Decimal('0'))
        self.assertEqual(block_a_row['remaining_kg'], Decimal('40000'))

    def test_remaining_decreases_with_each_draft(self):
        """Each draft shipment draws down the remaining pool."""
        from apps.export.services.harvest_forecast import get_remaining_for_date

        entry = _make_plan_and_entry(self.season, self.block_a, self.target_date, Decimal('30000'))

        # First draft draws 18,500. Cargo codes must be NNNNNNN/YY (7+2 digits).
        _make_shipment(
            '0106001/26', self.target_date, self.season, self.draft_status,
            self.block_a, Decimal('18500'),
        )

        rows = get_remaining_for_date(self.target_date)
        block_a_row = next(r for r in rows if r['block_id'] == self.block_a.id)

        self.assertEqual(block_a_row['allocated_kg'], Decimal('18500'))
        self.assertEqual(block_a_row['remaining_kg'], Decimal('11500'))

        # Second draft draws another 5,000 — remaining should be 6,500.
        _make_shipment(
            '0106002/26', self.target_date, self.season, self.draft_status,
            self.block_a, Decimal('5000'),
        )

        rows = get_remaining_for_date(self.target_date)
        block_a_row = next(r for r in rows if r['block_id'] == self.block_a.id)

        self.assertEqual(block_a_row['allocated_kg'], Decimal('23500'))
        self.assertEqual(block_a_row['remaining_kg'], Decimal('6500'))

        # Clean up for other tests.
        entry.forecast_value = None
        entry.save(update_fields=['forecast_value'])

    def test_remaining_never_negative(self):
        """Remaining is clamped to 0 even when allocated exceeds forecast."""
        from apps.export.services.harvest_forecast import get_remaining_for_date

        entry = _make_plan_and_entry(self.season, self.block_a, self.target_date, Decimal('5000'))

        # Allocate more than the forecast (edge case, e.g. forecast was revised down).
        _make_shipment(
            '0106003/26', self.target_date, self.season, self.draft_status,
            self.block_a, Decimal('6000'),
        )

        rows = get_remaining_for_date(self.target_date)
        block_a_row = next(r for r in rows if r['block_id'] == self.block_a.id)

        self.assertEqual(block_a_row['remaining_kg'], Decimal('0'))

        # Clean up.
        entry.forecast_value = None
        entry.save(update_fields=['forecast_value'])

    def test_cancelled_shipments_excluded_from_allocated(self):
        """Cancelled shipments do NOT count towards allocated_kg."""
        from apps.export.services.harvest_forecast import get_remaining_for_date

        entry = _make_plan_and_entry(self.season, self.block_a, self.target_date, Decimal('20000'))

        _make_shipment(
            '0106004/26', self.target_date, self.season, self.cancelled_status,
            self.block_a, Decimal('18500'),
        )

        rows = get_remaining_for_date(self.target_date)
        block_a_row = next(r for r in rows if r['block_id'] == self.block_a.id)

        # Cancelled shipment should not reduce the pool.
        self.assertEqual(block_a_row['allocated_kg'], Decimal('0'))
        self.assertEqual(block_a_row['remaining_kg'], Decimal('20000'))

        # Clean up.
        entry.forecast_value = None
        entry.save(update_fields=['forecast_value'])

    def test_blocks_without_forecast_not_in_results(self):
        """Blocks that have no forecast entry for the date are excluded."""
        from apps.export.services.harvest_forecast import get_remaining_for_date

        # block_b has no forecast entry for target_date.
        # We intentionally don't set forecast_value.
        _make_plan_and_entry(self.season, self.block_b, self.target_date, None)

        rows = get_remaining_for_date(self.target_date)
        block_b_ids = [r['block_id'] for r in rows if r['block_id'] == self.block_b.id]
        self.assertEqual(block_b_ids, [])

    def test_sorted_by_block_code(self):
        """Results are sorted alphabetically by block_code."""
        from apps.export.services.harvest_forecast import get_remaining_for_date

        other_date = datetime.date(2026, 6, 2)
        _make_plan_and_entry(self.season, self.block_b, other_date, Decimal('10000'))
        _make_plan_and_entry(self.season, self.block_a, other_date, Decimal('10000'))

        rows = get_remaining_for_date(other_date)
        codes = [r['block_code'] for r in rows]
        self.assertEqual(codes, sorted(codes))


# ---------------------------------------------------------------------------
# Tests: get_remaining_for_block
# ---------------------------------------------------------------------------

class GetRemainingForBlockTests(TestCase):
    """Tests for the single-block remaining helper."""

    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        cls.season = _make_season()
        cls.block, _ = GreenhouseBlock.objects.get_or_create(
            code='FC-C', defaults={'name': 'FC Block C', 'is_active': True},
        )
        cls.draft_status = _make_status('draft', 0, 'Draft')
        cls.target_date = datetime.date(2026, 6, 3)

    def test_returns_zero_when_no_forecast(self):
        from apps.export.services.harvest_forecast import get_remaining_for_block

        result = get_remaining_for_block(self.block.id, self.target_date)
        self.assertEqual(result, Decimal('0'))

    def test_returns_remaining_when_forecast_exists(self):
        from apps.export.services.harvest_forecast import get_remaining_for_block

        entry = _make_plan_and_entry(self.season, self.block, self.target_date, Decimal('25000'))
        _make_shipment(
            '0306001/26', self.target_date, self.season, self.draft_status,
            self.block, Decimal('10000'),
        )

        result = get_remaining_for_block(self.block.id, self.target_date)
        self.assertEqual(result, Decimal('15000'))

        # Clean up.
        entry.forecast_value = None
        entry.save(update_fields=['forecast_value'])


# ---------------------------------------------------------------------------
# Tests: POST /api/v1/export/harvest-forecast/ (upsert)
# ---------------------------------------------------------------------------

class ForecastSubmitViewTests(TestCase):
    """Tests for the forecast-submit endpoint.

    Each test uses a different date to avoid ordering-dependent state —
    set_forecast_value requires a reason when the admin overrides an
    *existing* value, so tests that write different dates start clean.
    """

    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        cls.season = _make_season()
        cls.block, _ = GreenhouseBlock.objects.get_or_create(
            code='FC-D', defaults={'name': 'FC Block D', 'is_active': True},
        )
        # Admin bypasses time-window checks in set_forecast_value.
        cls.admin_user = _make_user('admin_fc', 'admin')
        # loading_dept_head also allowed but has a time window — use admin in tests.
        cls.ldh_user = _make_user('ldh_fc', 'loading_dept_head')
        cls.manager_user = _make_user('mgr_fc', 'export_manager')

    def setUp(self):
        self.client = APIClient()

    def _post(self, user, date_str: str, entries: list) -> object:
        self.client.force_authenticate(user=user)
        return self.client.post(
            '/api/v1/export/harvest-forecast/',
            {'date': date_str, 'entries': entries},
            format='json',
        )

    def test_creates_harvest_day_entry_on_first_submit(self):
        """POST creates WeeklyHarvestPlan + HarvestDayEntry and sets forecast_value."""
        # Use a date that no other test writes to.
        date_str = '2026-06-05'
        resp = self._post(
            self.admin_user, date_str,
            [{'block_id': self.block.id, 'forecast_kg': '40000.00'}],
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['saved'], 1)
        self.assertEqual(resp.data['date'], date_str)

        entry = HarvestDayEntry.objects.get(
            block=self.block, entry_date=datetime.date.fromisoformat(date_str),
        )
        self.assertEqual(entry.forecast_value, Decimal('40000.00'))
        self.assertEqual(entry.forecast_submitted_by, self.admin_user)

    def test_sets_forecast_value_on_entry_with_none(self):
        """POST on an existing entry whose forecast_value is None succeeds (upsert).

        Admin requires a reason only when overriding an EXISTING (non-null) value.
        First-time write (forecast_value=None) needs no reason.
        """
        # Use a distinct date to avoid state from other tests.
        upsert_date = datetime.date(2026, 6, 9)
        entry = _make_plan_and_entry(self.season, self.block, upsert_date, None)

        resp = self._post(
            self.admin_user, str(upsert_date),
            [{'block_id': self.block.id, 'forecast_kg': '30000.00'}],
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        entry.refresh_from_db()
        self.assertEqual(entry.forecast_value, Decimal('30000.00'))

    def test_notification_created_for_loading_dept_head(self):
        """Successful submit creates a forecast_handoff Notification for ldh users."""
        notif_date = datetime.date(2026, 6, 10)
        resp = self._post(
            self.admin_user, str(notif_date),
            [{'block_id': self.block.id, 'forecast_kg': '15000.00'}],
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        # The ldh_user (loading_dept_head) should have received a notification.
        notif = Notification.objects.filter(
            user=self.ldh_user, kind='forecast_handoff',
        ).order_by('-created_at').first()
        self.assertIsNotNone(notif, 'Expected forecast_handoff notification for loading_dept_head')
        self.assertIn(str(notif_date), notif.message)

    def test_403_for_disallowed_role(self):
        """export_manager cannot submit forecasts."""
        resp = self._post(
            self.manager_user,
            '2026-06-11',
            [{'block_id': self.block.id, 'forecast_kg': '10000.00'}],
        )
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_400_for_missing_date(self):
        self.client.force_authenticate(user=self.admin_user)
        resp = self.client.post(
            '/api/v1/export/harvest-forecast/',
            {'entries': [{'block_id': self.block.id, 'forecast_kg': '1000'}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_400_for_duplicate_block_ids(self):
        resp = self._post(
            self.admin_user,
            '2026-06-12',
            [
                {'block_id': self.block.id, 'forecast_kg': '1000'},
                {'block_id': self.block.id, 'forecast_kg': '2000'},
            ],
        )
        self.assertEqual(resp.status_code, 400)

    def test_400_for_unknown_block(self):
        resp = self._post(
            self.admin_user,
            '2026-06-13',
            [{'block_id': 99999, 'forecast_kg': '1000'}],
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Unknown block_id', str(resp.data))


# ---------------------------------------------------------------------------
# Tests: GET /api/v1/export/harvest-forecast/remaining/
# ---------------------------------------------------------------------------

class RemainingEndpointTests(TestCase):
    """Tests for GET /api/v1/export/harvest-forecast/remaining/."""

    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        cls.season = _make_season()
        cls.block, _ = GreenhouseBlock.objects.get_or_create(
            code='FC-E', defaults={'name': 'FC Block E', 'is_active': True},
        )
        cls.user = _make_user('reader_fc', 'export_manager')
        cls.target_date = datetime.date(2026, 6, 6)

        # Set up a forecast entry with a known value.
        cls.entry = _make_plan_and_entry(
            cls.season, cls.block, cls.target_date, Decimal('20000'),
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_remaining_for_date(self):
        resp = self.client.get(
            f'/api/v1/export/harvest-forecast/remaining/?date={self.target_date}'
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertIsInstance(resp.data, list)

        row = next(
            (r for r in resp.data if r['block_id'] == self.block.id), None
        )
        self.assertIsNotNone(row, 'Expected block FC-E in response')
        self.assertEqual(row['forecast_kg'], '20000.00')
        self.assertEqual(row['remaining_kg'], '20000.00')
        self.assertEqual(row['allocated_kg'], '0.00')

    def test_400_when_date_missing(self):
        resp = self.client.get('/api/v1/export/harvest-forecast/remaining/')
        self.assertEqual(resp.status_code, 400)

    def test_400_when_date_invalid(self):
        resp = self.client.get('/api/v1/export/harvest-forecast/remaining/?date=not-a-date')
        self.assertEqual(resp.status_code, 400)

    def test_401_when_unauthenticated(self):
        self.client.logout()
        resp = self.client.get(
            f'/api/v1/export/harvest-forecast/remaining/?date={self.target_date}'
        )
        self.assertIn(resp.status_code, [401, 403])


# ---------------------------------------------------------------------------
# Tests: draft-create pool drawdown validation
# ---------------------------------------------------------------------------

class DraftCreateDrawdownTests(TestCase):
    """Draft-create validation enforces forecast pool and 18,500 cap."""

    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command

        call_command('seed_permissions')

        GreenhouseConfig.get_solo()
        cls.season = _make_season()
        cls.block, _ = GreenhouseBlock.objects.get_or_create(
            code='FC-F', defaults={'name': 'FC Block F', 'is_active': True},
        )
        # Statuses needed by _create_draft_shipment.
        cls.draft_status = _make_status('draft', 0, 'Draft')
        # gumruk_girish needed for TaskRule references (seed_permissions adds roles).
        _make_status('gumruk_girish', 2, 'Customs entry', phase='CUSTOMS')
        _make_status('cancelled', 99, 'Cancelled', phase='CANCELLED')

        # warehouse_chief is the role that creates drafts in the DraftPool flow.
        cls.user = _make_user('wh_draw', 'warehouse_chief')
        # export_manager is needed for non-draft creation test.
        cls.em_user = _make_user('em_draw', 'export_manager')
        cls.target_date = datetime.date(2026, 6, 8)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        # Set a fresh forecast for each test so we get predictable remaining.
        self.entry = _make_plan_and_entry(
            self.season, self.block, self.target_date, Decimal('20000'),
        )

    def tearDown(self):
        # Reset the forecast and delete any shipments created during the test.
        self.entry.forecast_value = Decimal('20000')
        self.entry.save(update_fields=['forecast_value'])
        ShipmentBlockSource.objects.filter(
            block=self.block, shipment__date=self.target_date,
        ).delete()
        Shipment.objects.filter(date=self.target_date, season=self.season).delete()

    def _post_draft(self, cargo_code: str, weight_kg: str, date=None) -> object:
        return self.client.post(
            '/api/v1/export/shipments/',
            {
                'cargo_code': cargo_code,
                'date': str(date or self.target_date),
                'is_draft': True,
                'block_sources': [
                    {'block_id': self.block.id, 'weight_kg': weight_kg},
                ],
            },
            format='json',
        )

    def test_rejects_draw_over_18500(self):
        """A single-block draw > 18,500 kg is rejected with 400."""
        # Cargo code: NNNNNNN/YY format — 7 digits / 2 digits.
        resp = self._post_draft('0806001/26', '18501')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('18,500', str(resp.data))

    def test_rejects_draw_over_remaining(self):
        """A draw that exceeds the remaining forecast pool is rejected with 400."""
        # 20,000 forecast; request 18,500 (ok) to leave 1,500 remaining,
        # then try to draw 5,000 (over remaining).
        resp1 = self._post_draft('0806002/26', '18500')
        self.assertEqual(resp1.status_code, 201, resp1.data)

        resp2 = self._post_draft('0806003/26', '5000')
        self.assertEqual(resp2.status_code, 400, resp2.data)
        # Error must mention the block.
        error_text = str(resp2.data)
        self.assertIn('FC-F', error_text)

    def test_happy_path_within_remaining(self):
        """A draw within remaining succeeds and creates a draft."""
        resp = self._post_draft('0806004/26', '15000')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(
            Shipment.objects.filter(cargo_code='0806004/26').count(), 1
        )

    def test_no_forecast_entry_rejects_draft(self):
        """If no forecast entry exists for the block+date, creation is rejected."""
        # Use a date with no forecast — July 1 has no plan entry.
        future_date = datetime.date(2026, 7, 1)
        resp = self._post_draft('0107001/26', '5000', date=future_date)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn('no forecast', str(resp.data).lower())

    def test_non_draft_creation_skips_pool_validation(self):
        """Non-draft shipment creation does NOT enforce the forecast pool."""
        # The standard (non-draft) creation path doesn't check block_sources
        # against the forecast pool; it should succeed even with no forecast entry.
        # Only export_manager / director may create non-draft shipments.
        self.client.force_authenticate(user=self.em_user)
        resp = self.client.post(
            '/api/v1/export/shipments/',
            {
                'cargo_code': '0806005/26',
                'date': str(self.target_date),
                'is_draft': False,
            },
            format='json',
        )
        # 201 Created expected (non-draft, no pool check).
        self.assertEqual(resp.status_code, 201, resp.data)
