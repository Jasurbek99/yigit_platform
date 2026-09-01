"""Access control for the daily harvest board endpoint (F1 — CRITICAL).

`POST /api/v1/greenhouse/daily-plan/` writes `HarvestDayEntry.forecast_value`,
the same column the Weekly Plan grid guards with a role x window x block-assignment
matrix. The board deliberately relaxes those gates — its docstring says *any
authenticated user with page access may edit* — but the "with page access" half was
never enforced: the viewset carried `IsAuthenticated` and nothing else, so a role
that cannot even see the page (e.g. `seller`) could rewrite any block's forecast for
any date.

This suite pins the page gate on `export.harvest_board` for WRITES, and pins that
READS stay open on purpose (that narrowing is F4's separate question).

Usage:
    python manage.py test apps.greenhouse.tests.test_daily_board_access --verbosity=2
"""
import unittest

try:
    from django.contrib.auth import get_user_model
    from django.core.cache import cache
    from django.test import TestCase
    from rest_framework.test import APIClient

    from apps.core.models import (
        GreenhouseBlock,
        GreenhouseConfig,
        RolePagePermission,
        Season,
    )
    from apps.greenhouse.models import HarvestDayEntry

    DB_AVAILABLE = True
except Exception:  # pragma: no cover
    DB_AVAILABLE = False

PAGE_CODE = 'export.harvest_board'
URL = '/api/v1/greenhouse/daily-plan/'


@unittest.skipUnless(DB_AVAILABLE, "Django test DB unavailable in this environment")
class TestDailyBoardWriteNeedsPageAccess(TestCase):
    """Who may POST to the board — decided by `export.harvest_board` visibility."""

    @classmethod
    def setUpTestData(cls):
        GreenhouseConfig.get_solo()
        Season.objects.update(is_active=False)
        cls.season = Season.objects.create(
            name='2026-F1', start_date='2025-09-01', end_date='2026-08-31', is_active=True,
        )
        cls.block = GreenhouseBlock.objects.create(code='F1-A', name='F1 A', is_active=True)

        User = get_user_model()
        # Page granted.
        cls.granted = User.objects.create_user(
            username='t_f1_granted', password='x', role='warehouse_chief',
        )
        # Page row exists but is switched off.
        cls.hidden = User.objects.create_user(
            username='t_f1_hidden', password='x', role='seller',
        )
        # No row at all for this page — the fail-closed case.
        cls.unrowed = User.objects.create_user(
            username='t_f1_unrowed', password='x', role='accountant',
        )
        # Superuser whose role is one of the hidden ones.
        cls.superuser = User.objects.create_superuser(
            username='t_f1_super', password='x', role='seller',
        )

        RolePagePermission.objects.filter(page_code=PAGE_CODE).delete()
        RolePagePermission.objects.create(
            role='warehouse_chief', page_code=PAGE_CODE, is_visible=True,
        )
        RolePagePermission.objects.create(
            role='seller', page_code=PAGE_CODE, is_visible=False,
        )
        # 'accountant' deliberately gets no row.

    def setUp(self):
        # get_page_permissions() is cached per role; a stale entry would decide
        # the gate instead of the rows above.
        cache.clear()

    def _client(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _payload(self, plan='120'):
        return {'block': self.block.pk, 'date': '2026-07-13', 'today_plan': plan}

    def test_role_with_the_page_may_write(self):
        response = self._client(self.granted).post(URL, self._payload('120'))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['today_plan'], '120')

    def test_role_whose_page_is_switched_off_is_refused(self):
        response = self._client(self.hidden).post(URL, self._payload('999'))
        self.assertEqual(response.status_code, 403, response.content)

    def test_role_with_no_page_row_is_refused(self):
        """Fail-closed: an unseeded role must not inherit write access."""
        response = self._client(self.unrowed).post(URL, self._payload('999'))
        self.assertEqual(response.status_code, 403, response.content)

    def test_a_refused_write_leaves_no_entry_behind(self):
        self._client(self.hidden).post(URL, self._payload('999'))
        self._client(self.unrowed).post(URL, self._payload('999'))
        self.assertFalse(
            HarvestDayEntry.objects.filter(block=self.block, entry_date='2026-07-13').exists()
        )

    def test_superuser_bypasses_the_page_gate(self):
        response = self._client(self.superuser).post(URL, self._payload('80'))
        self.assertEqual(response.status_code, 200, response.content)

    def test_reads_stay_open_to_a_role_without_the_page(self):
        """Deliberate: F1 is a write hole. Narrowing board READS is F4's call —
        do not tighten this without closing F4 as well."""
        response = self._client(self.hidden).get(URL)
        self.assertEqual(response.status_code, 200, response.content)

    def test_anonymous_is_still_refused(self):
        self.assertIn(APIClient().post(URL, self._payload()).status_code, (401, 403))
