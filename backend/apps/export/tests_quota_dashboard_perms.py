"""Regression tests for QuotaDashboardView permission gating.

Guards against the cc28108 regression where QuotaDashboardView used
``resource_code = 'quota'`` — a resource that does not exist in
RESOURCE_REGISTRY — so DynamicResourcePermission returned 403 for every
non-superuser role (export_manager, document_team, director), surfacing as
"Failed to load quota data" on the frontend.

The dashboard is now gated by ``quota_issuance`` view access, which exactly
matches the roles that can see the export.quota page.
"""
from datetime import date

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import ExportFirm, Season, User
from apps.export.models import QuotaIssuance, QuotaIssuanceFirmAllocation

URL = '/api/v1/export/quota-dashboard/'


def _make_user(username: str, role: str) -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


class QuotaDashboardPermissionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.season = Season.objects.create(
            name='qd25', start_date='2025-09-01', end_date='2026-06-30', is_active=True,
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_export_manager_can_load_dashboard(self):
        """The named bug: export_manager must get 200, not 403."""
        self.client.force_authenticate(user=_make_user('gadam', 'export_manager'))
        resp = self.client.get(URL, {'season': self.season.id})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn('kpis', resp.data)

    def test_document_team_can_load_dashboard(self):
        """document_team has the export.quota page + quota_issuance view → 200."""
        self.client.force_authenticate(user=_make_user('sulgun', 'document_team'))
        resp = self.client.get(URL, {'season': self.season.id})
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_role_without_quota_access_is_forbidden(self):
        """seller has no quota_issuance perm → 403 (frontend gates the query)."""
        self.client.force_authenticate(user=_make_user('seller1', 'seller'))
        resp = self.client.get(URL, {'season': self.season.id})
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_anonymous_is_unauthorized(self):
        resp = self.client.get(URL, {'season': self.season.id})
        self.assertEqual(resp.status_code, 401, resp.content)


class QuotaDashboardSeasonResolutionTests(TestCase):
    """`?season=` on the dashboard goes through `resolve_season()` like every
    other read path (AD-16).

    It used to read the parameter directly, look the row up itself, and 400 if
    it was absent — so `closed_season.can_view` was never consulted. Verified
    on the live database: `document_team`, `loading_dept_head` and
    `loading_dept_head_deputy` hold `quota_issuance` but NOT `closed_season`,
    so they are correctly 403'd on `/quota-issuances/?season=<closed>` yet
    could still read that same season's aggregates here.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.active = Season.objects.create(
            name='qd26', start_date='2026-08-01', end_date='2027-06-30', is_active=True,
        )
        cls.closed = Season.objects.create(
            name='qd25', start_date='2025-09-01', end_date='2026-06-30',
            closed_at=timezone.now(),
        )
        # export_manager holds closed_season.can_view per the AD-16 seed;
        # document_team does not. Both hold quota_issuance.can_view, so the
        # pair isolates the closed-season permission from page access.
        cls.permitted = _make_user('gadam', 'export_manager')
        cls.unpermitted = _make_user('sulgun', 'document_team')

        # A real allocation INSIDE the closed season, so "did the closed
        # season's data reach this response" is an observable number rather
        # than an assertion about an empty payload that would pass either way.
        cls.ISSUED_KG = 25000
        firm = ExportFirm.objects.create(code='QDF', name_en='QD Firm')
        issuance = QuotaIssuance.objects.create(
            issue_date=date(2025, 10, 6), product_type='tomato',
            matched_week=41, matched_year=2025, season=cls.closed,
        )
        QuotaIssuanceFirmAllocation.objects.create(
            issuance=issuance, export_firm=firm, kg_quota=cls.ISSUED_KG,
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_closed_season_denied_without_closed_season_permission(self):
        self.client.force_authenticate(user=self.unpermitted)
        resp = self.client.get(URL, {'season': self.closed.id})
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_closed_season_allowed_with_closed_season_permission(self):
        self.client.force_authenticate(user=self.permitted)
        resp = self.client.get(URL, {'season': self.closed.id})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn('kpis', resp.data)

    def test_unknown_season_returns_404(self):
        """`resolve_season()` raises NotFound; the endpoint used to 400."""
        self.client.force_authenticate(user=self.permitted)
        resp = self.client.get(URL, {'season': 999999})
        self.assertEqual(resp.status_code, 404, resp.content)

    def test_season_param_omitted_falls_back_to_the_active_season(self):
        """`?season=` was `required` here and nowhere else. Every other scoped
        read defaults to the active season; this one 400'd."""
        self.client.force_authenticate(user=self.permitted)
        resp = self.client.get(URL)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn('kpis', resp.data)

    def test_out_of_season_date_window_cannot_reach_a_closed_season(self):
        """The gate is bypassable unless the window is CLAMPED to the season.

        `resolve_season()` only supplied the *default* date window;
        `?date_from=`/`?date_to=` were taken verbatim and `build_quota_dashboard`
        aggregates on dates alone. So an unpermitted user needed no `?season=`
        at all — send the closed season's own date range, the gate passes on the
        ACTIVE season, and the response carries the closed season's numbers.
        That is exactly the payload
        `test_closed_season_denied_without_closed_season_permission` asserts must
        be a 403.

        Clamping (`max(from, season.start_date)` / `min(to, season.end_date)`)
        is monotonically restrictive: it changes no in-season number and needs
        no ruling on whether the aggregates should carry a season FK.
        """
        self.client.force_authenticate(user=self.unpermitted)
        resp = self.client.get(URL, {
            'date_from': self.closed.start_date,
            'date_to': self.closed.end_date,
        })
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(
            resp.data['kpis']['issued_kg'], 0,
            'Closed-season issuances leaked through an unbounded date window.',
        )
        self.assertEqual(resp.data['per_firm'], [])

    def test_permitted_user_still_sees_the_closed_season_with_its_own_window(self):
        """Control — the clamp must not close the legitimate door as well."""
        self.client.force_authenticate(user=self.permitted)
        resp = self.client.get(URL, {
            'season': self.closed.id,
            'date_from': self.closed.start_date,
            'date_to': self.closed.end_date,
        })
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['kpis']['issued_kg'], self.ISSUED_KG)

    def test_in_season_window_is_untouched_by_the_clamp(self):
        """Control — a window inside the season passes through unchanged."""
        self.client.force_authenticate(user=self.permitted)
        resp = self.client.get(URL, {
            'season': self.closed.id,
            'date_from': '2025-10-01',
            'date_to': '2025-10-31',
        })
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['kpis']['issued_kg'], self.ISSUED_KG)

    def test_denied_response_is_not_served_from_another_users_cache(self):
        """The 403 must precede the cache read, or a permitted user's payload
        leaks to an unpermitted one for the 60s TTL."""
        self.client.force_authenticate(user=self.permitted)
        self.assertEqual(
            self.client.get(URL, {'season': self.closed.id}).status_code, 200,
        )
        self.client.force_authenticate(user=self.unpermitted)
        resp = self.client.get(URL, {'season': self.closed.id})
        self.assertEqual(resp.status_code, 403, resp.content)


class QuotaDashboardNoActiveSeasonTests(TestCase):
    """D7 fail-closed: during the close→open gap the dashboard returns an
    empty payload with its shape preserved, not the just-closed season's
    aggregates and not a 400.

    Same treatment `dashboard/summary` got in the final review (finding F3):
    the page renders its normal empty states rather than an error banner.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        Season.objects.create(
            name='qd25', start_date='2025-09-01', end_date='2026-06-30',
            closed_at=timezone.now(),
        )
        cls.user = _make_user('gadam', 'export_manager')

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_no_active_season_returns_empty_shaped_payload(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(URL)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(set(resp.data), {'kpis', 'per_firm', 'weekly_flow'})
        self.assertEqual(resp.data['per_firm'], [])
        self.assertEqual(resp.data['weekly_flow'], [])
        self.assertEqual(resp.data['kpis']['issued_kg'], 0)
        self.assertEqual(resp.data['kpis']['local_sales_kg'], 0)
