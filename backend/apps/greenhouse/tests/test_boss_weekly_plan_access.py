"""Tests that the 'boss' role holds operational admin authority on the weekly plan.

Stakeholder decision (Aug 2026): boss is the company owner and may do anything
admin can do on OPERATIONAL data. `seed_permissions` already granted him '*' on
every resource; the hardcoded `role == 'admin'` string compares in the greenhouse
views/services were the only thing denying him — this suite pins the fix.

NOT covered here on purpose: user management and the permission matrix stay
admin-only per AD-15.

Usage:
    python manage.py test apps.greenhouse.tests.test_boss_weekly_plan_access --verbosity=2
"""
import unittest
from datetime import date, timedelta
from decimal import Decimal

try:
    from django.test import TestCase
    from django.utils import timezone
    from rest_framework.test import APIClient

    from apps.core.models import GreenhouseBlock, GreenhouseConfig, Season
    from apps.core.roles import ADMIN_LIKE, HARVEST_DAY_WRITE, is_admin_like
    from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan
    from apps.greenhouse.services.harvest_day_service import (
        set_actual_value,
        set_forecast_value,
        set_plan_value,
    )

    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestBossIsAdminLike(TestCase):
    """The shared helper — the single source of truth for the widened gates."""

    def test_boss_and_admin_are_admin_like(self):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        self.assertTrue(is_admin_like(User(username='t_boss', role='boss')))
        self.assertTrue(is_admin_like(User(username='t_admin', role='admin')))

    def test_ordinary_role_is_not_admin_like(self):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        self.assertFalse(is_admin_like(User(username='t_wm', role='weight_master')))

    def test_superuser_is_admin_like_regardless_of_role(self):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        self.assertTrue(
            is_admin_like(User(username='t_su', role='transport', is_superuser=True))
        )

    def test_boss_in_harvest_day_write(self):
        self.assertIn('boss', ADMIN_LIKE)
        self.assertIn('boss', HARVEST_DAY_WRITE)


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestBossWeeklyPlanWrites(TestCase):
    """Boss can enter plan / forecast / actual values, same as admin."""

    @classmethod
    def setUpTestData(cls):
        from django.contrib.auth import get_user_model
        User = get_user_model()

        GreenhouseConfig.get_solo()
        cls.season, _ = Season.objects.get_or_create(
            name='2025-BOSS',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-08-31',
                'is_active': True,
            },
        )
        cls.block, _ = GreenhouseBlock.objects.get_or_create(
            code='BOSS-A', defaults={'name': 'Boss Block A', 'is_active': True},
        )
        cls.boss = User.objects.create_user(
            username='bp_boss', password='pass', role='boss',
        )
        cls.outsider = User.objects.create_user(
            username='bp_transport', password='pass', role='transport',
        )

    def _entry(self, weekday=0, iso_year=2026, iso_week=30):
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=self.block, year=iso_year, week_number=iso_week,
        )
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=plan,
            entry_date=date.fromisocalendar(iso_year, iso_week, weekday + 1),
            defaults={'season': self.season, 'block': self.block, 'weekday': weekday},
        )
        return plan, entry

    def test_boss_can_set_plan_value(self):
        _, entry = self._entry(weekday=0)
        set_plan_value(entry, Decimal('4200.00'), self.boss)
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('4200.00'))
        self.assertEqual(entry.plan_submitted_by_id, self.boss.id)

    def test_boss_overwriting_a_filled_plan_cell_requires_a_reason(self):
        """Boss folds into the admin branch, so the override contract applies to him too."""
        _, entry = self._entry(weekday=1)
        set_plan_value(entry, Decimal('1000.00'), self.boss)
        entry.refresh_from_db()

        with self.assertRaises(ValueError):
            set_plan_value(entry, Decimal('2000.00'), self.boss)

        set_plan_value(entry, Decimal('2000.00'), self.boss, reason='corrected after weigh-in')
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('2000.00'))
        self.assertEqual(entry.last_override_by_id, self.boss.id)

    def test_boss_can_set_forecast_and_actual_values(self):
        _, entry = self._entry(weekday=2)
        set_forecast_value(entry, Decimal('3300.00'), self.boss)
        set_actual_value(entry, Decimal('3100.00'), self.boss)
        entry.refresh_from_db()
        self.assertEqual(entry.forecast_value, Decimal('3300.00'))
        self.assertEqual(entry.actual_value, Decimal('3100.00'))

    def test_unprivileged_role_still_denied(self):
        _, entry = self._entry(weekday=3)
        with self.assertRaises(PermissionError):
            set_plan_value(entry, Decimal('900.00'), self.outsider)


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestBossWeeklyPlanEndpoints(TestCase):
    """Boss passes the viewset-level gates: PATCH a plan row and grant late-edit."""

    @classmethod
    def setUpTestData(cls):
        from django.contrib.auth import get_user_model
        User = get_user_model()

        GreenhouseConfig.get_solo()
        cls.season, _ = Season.objects.get_or_create(
            name='2025-BAPI',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-08-31',
                'is_active': True,
            },
        )
        cls.block, _ = GreenhouseBlock.objects.get_or_create(
            code='BOSS-B', defaults={'name': 'Boss Block B', 'is_active': True},
        )
        cls.boss = User.objects.create_user(
            username='ba_boss', password='pass', role='boss',
        )
        cls.outsider = User.objects.create_user(
            username='ba_transport', password='pass', role='transport',
        )
        cls.plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=cls.season, block=cls.block, year=2026, week_number=31,
        )

    def setUp(self):
        self.client = APIClient()

    def test_boss_can_patch_a_day_entry_plan_value(self):
        """The exact request the grid makes when boss types into a plan cell.

        The service-level tests above call `set_plan_value` directly and would
        stay green even if a viewset-layer gate denied boss, which is precisely
        the failure the owner reported ("can initialize but can't enter data").
        """
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=self.plan,
            entry_date=date.fromisocalendar(2026, 31, 4),
            defaults={'season': self.season, 'block': self.block, 'weekday': 3},
        )
        self.client.force_authenticate(user=self.boss)
        resp = self.client.patch(
            f'/api/v1/greenhouse/day-entries/{entry.id}/',
            {'plan_value': '5500.00'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('5500.00'))

    def test_boss_can_patch_a_day_entry_actual_value(self):
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=self.plan,
            entry_date=date.fromisocalendar(2026, 31, 5),
            defaults={'season': self.season, 'block': self.block, 'weekday': 4},
        )
        self.client.force_authenticate(user=self.boss)
        resp = self.client.patch(
            f'/api/v1/greenhouse/day-entries/{entry.id}/',
            {'actual_value': '4400.00'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.actual_value, Decimal('4400.00'))

    def test_boss_can_initialize_a_week(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.post(
            '/api/v1/greenhouse/harvest-plans/initialize-week/',
            {'season': self.season.id, 'week_number': 32, 'year': 2026},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_boss_can_submit_the_harvest_forecast(self):
        """POST /export/harvest-forecast/ gates on HARVEST_DAY_WRITE, not on the service."""
        self.client.force_authenticate(user=self.boss)
        resp = self.client.post(
            '/api/v1/export/harvest-forecast/',
            {
                'date': date.fromisocalendar(2026, 31, 6).isoformat(),
                'entries': [{'block_id': self.block.id, 'forecast_kg': '1200.00'}],
            },
            format='json',
        )
        self.assertNotEqual(resp.status_code, 403, resp.data)

    def test_boss_can_generate_weekly_plan_tasks(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.post(
            '/api/v1/export/tasks/generate-weekly-plan/',
            {'year': 2026, 'week': 31},
            format='json',
        )
        self.assertNotEqual(resp.status_code, 403, resp.data)

    def test_boss_can_grant_late_edit(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.post(
            f'/api/v1/greenhouse/harvest-plans/{self.plan.id}/grant-late-edit/',
            {
                'granted_until': (timezone.now() + timedelta(days=2)).isoformat(),
                'reason': 'owner override',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.late_edit_granted_by_id, self.boss.id)

    def test_boss_can_revoke_late_edit(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.post(
            f'/api/v1/greenhouse/harvest-plans/{self.plan.id}/revoke-late-edit/',
            {},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_unprivileged_role_still_denied_on_grant_late_edit(self):
        self.client.force_authenticate(user=self.outsider)
        resp = self.client.post(
            f'/api/v1/greenhouse/harvest-plans/{self.plan.id}/grant-late-edit/',
            {'granted_until': (timezone.now() + timedelta(days=2)).isoformat()},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestBossBulkLateEditEndpoints(TestCase):
    """The two bulk late-edit actions — the is_admin_like sites the per-row tests miss.

    grant-late-edit / revoke-late-edit (detail actions) are covered above.
    bulk-grant-late-edit / bulk-revoke-late-edit moved to the same helper in the
    same commit and had no test at all; the grid calls the bulk pair when the
    owner selects several week rows at once.
    """

    @classmethod
    def setUpTestData(cls):
        from django.contrib.auth import get_user_model
        User = get_user_model()

        GreenhouseConfig.get_solo()
        cls.season, _ = Season.objects.get_or_create(
            name='2025-BULK',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-08-31',
                'is_active': True,
            },
        )
        cls.block, _ = GreenhouseBlock.objects.get_or_create(
            code='BOSS-C', defaults={'name': 'Boss Block C', 'is_active': True},
        )
        cls.boss = User.objects.create_user(
            username='bb_boss', password='pass', role='boss',
        )
        cls.outsider = User.objects.create_user(
            username='bb_transport', password='pass', role='transport',
        )
        # A superuser holding an unrelated role — is_admin_like short-circuits on
        # is_superuser before it ever looks at `role`.
        cls.superuser = User.objects.create_user(
            username='bb_su', password='pass', role='transport', is_superuser=True,
        )
        cls.plan_a, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=cls.season, block=cls.block, year=2026, week_number=33,
        )
        cls.plan_b, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=cls.season, block=cls.block, year=2026, week_number=34,
        )

    def setUp(self):
        self.client = APIClient()

    def _plan_ids(self):
        return [self.plan_a.id, self.plan_b.id]

    def _grant_payload(self):
        return {
            'plan_ids': self._plan_ids(),
            'granted_until': (timezone.now() + timedelta(days=3)).isoformat(),
            'reason': 'owner bulk override',
        }

    def test_boss_can_bulk_grant_late_edit(self):
        self.client.force_authenticate(user=self.boss)
        resp = self.client.post(
            '/api/v1/greenhouse/harvest-plans/bulk-grant-late-edit/',
            self._grant_payload(),
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.plan_a.refresh_from_db()
        self.plan_b.refresh_from_db()
        self.assertEqual(self.plan_a.late_edit_granted_by_id, self.boss.id)
        self.assertEqual(self.plan_b.late_edit_granted_by_id, self.boss.id)

    def test_boss_can_bulk_revoke_late_edit(self):
        self.client.force_authenticate(user=self.boss)
        self.client.post(
            '/api/v1/greenhouse/harvest-plans/bulk-grant-late-edit/',
            self._grant_payload(),
            format='json',
        )
        resp = self.client.post(
            '/api/v1/greenhouse/harvest-plans/bulk-revoke-late-edit/',
            {'plan_ids': self._plan_ids()},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.plan_a.refresh_from_db()
        self.assertIsNone(self.plan_a.late_edit_granted_until)
        self.assertIsNone(self.plan_a.late_edit_granted_by_id)

    def test_superuser_with_a_non_admin_role_passes_the_bulk_gate(self):
        """The is_superuser short-circuit, asserted at the HTTP layer for once."""
        self.client.force_authenticate(user=self.superuser)
        resp = self.client.post(
            '/api/v1/greenhouse/harvest-plans/bulk-grant-late-edit/',
            self._grant_payload(),
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_unprivileged_role_denied_on_bulk_grant(self):
        self.client.force_authenticate(user=self.outsider)
        resp = self.client.post(
            '/api/v1/greenhouse/harvest-plans/bulk-grant-late-edit/',
            self._grant_payload(),
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_unprivileged_role_denied_on_bulk_revoke(self):
        self.client.force_authenticate(user=self.outsider)
        resp = self.client.post(
            '/api/v1/greenhouse/harvest-plans/bulk-revoke-late-edit/',
            {'plan_ids': self._plan_ids()},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestOverrideBranchWidenedByExactlyOneRole(TestCase):
    """HARVEST_DAY_OVERRIDE went from {'admin'} to ADMIN_LIKE — and no further.

    The override branch is what forces a reason and writes the last_override_*
    snapshot. Boss joined it; greenhouse_manager — who IS in HARVEST_DAY_WRITE
    and can therefore overwrite a filled cell — did not, and still leaves no
    override snapshot behind. That asymmetry is pre-existing behaviour; this
    test pins it so the next widening has to be deliberate.
    """

    @classmethod
    def setUpTestData(cls):
        from django.contrib.auth import get_user_model
        from apps.greenhouse.models import BlockManagerAssignment
        User = get_user_model()

        GreenhouseConfig.get_solo()
        cls.season, _ = Season.objects.get_or_create(
            name='2025-OVR',
            defaults={
                'start_date': '2025-09-01',
                'end_date': '2026-08-31',
                'is_active': True,
            },
        )
        cls.block, _ = GreenhouseBlock.objects.get_or_create(
            code='BOSS-D', defaults={'name': 'Boss Block D', 'is_active': True},
        )
        cls.manager = User.objects.create_user(
            username='ovr_gm', password='pass', role='greenhouse_manager',
        )
        BlockManagerAssignment.objects.get_or_create(
            user=cls.manager, block=cls.block, defaults={'is_active': True},
        )
        # Current ISO week — a greenhouse_manager edit window stays open through
        # the week's own Sunday, so a past week would fail on the window rather
        # than on the branch under test.
        cls.iso_year, cls.iso_week, _ = date.today().isocalendar()
        cls.plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=cls.season, block=cls.block,
            year=cls.iso_year, week_number=cls.iso_week,
        )

    def test_override_set_is_exactly_admin_like(self):
        """Documentation pin, not a gate.

        `HARVEST_DAY_OVERRIDE` has zero production consumers — grep it: the
        override rule is enforced by the `is_admin_like(user)` branch inside
        `set_plan_value`, and the constant only records the intent. Asserting it
        keeps the record honest if the branch is widened without it (or vice
        versa); the test with teeth is the snapshot one below.
        """
        from apps.core.roles import HARVEST_DAY_OVERRIDE
        self.assertEqual(HARVEST_DAY_OVERRIDE, ADMIN_LIKE)
        self.assertSetEqual(set(HARVEST_DAY_OVERRIDE), {'admin', 'boss'})

    def test_a_harvest_day_writer_is_not_automatically_an_overrider(self):
        from apps.core.roles import HARVEST_DAY_OVERRIDE
        self.assertIn('greenhouse_manager', HARVEST_DAY_WRITE)
        self.assertNotIn('greenhouse_manager', HARVEST_DAY_OVERRIDE)

    def test_greenhouse_manager_overwrite_takes_no_reason_and_writes_no_snapshot(self):
        entry, _ = HarvestDayEntry.objects.get_or_create(
            weekly_plan=self.plan,
            entry_date=date.fromisocalendar(self.iso_year, self.iso_week, 1),
            defaults={'season': self.season, 'block': self.block, 'weekday': 0},
        )
        set_plan_value(entry, Decimal('1000.00'), self.manager)
        # No ValueError here — the reason requirement lives in the admin-like
        # branch only. Boss hitting the same second write DOES raise; see
        # TestBossWeeklyPlanWrites.test_boss_overwriting_a_filled_plan_cell_requires_a_reason.
        set_plan_value(entry, Decimal('2000.00'), self.manager)
        entry.refresh_from_db()
        self.assertEqual(entry.plan_value, Decimal('2000.00'))
        self.assertIsNone(entry.last_override_by_id)
        self.assertIsNone(entry.last_override_at)
