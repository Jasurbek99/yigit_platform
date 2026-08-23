"""D11 — quota never crosses a season boundary, in either direction (spec §4.7).

This module is the direct reversal of `QuotaIssuanceOptOutTests` in
`tests_season_optout.py`, which asserted the opposite under D10. Both halves of
the ruling are covered:

  * display  — `quota-issuances` is season-scoped like any other direct-FK list;
  * consumption — FIFO matching and the per-firm balance stop at the boundary.

Run with:
    python manage.py test apps.export.tests_quota_season_d11 --verbosity=2
"""
from datetime import date
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import (
    Country, ExportFirm, RoleResourcePermission, Season, ShipmentStatusType, User,
)
from apps.export.models import (
    QuotaIssuance, QuotaIssuanceFirmAllocation, QuotaUsageRecord, Shipment,
)
from apps.export.services_quota import compute_fifo_usage, compute_firm_quota_balances


def _make_status() -> ShipmentStatusType:
    """get_or_create the 'draft' status row — see tests_season_scoping._make_status."""
    status, _ = ShipmentStatusType.objects.get_or_create(
        code='draft',
        defaults={
            'name_tk': 'Garalama', 'name_en': 'Draft', 'name_ru': 'Черновик',
            'phase': 'DRAFT', 'step_order': 0, 'required_role': 'warehouse_chief',
        },
    )
    return status


class QuotaSeasonFixture(TestCase):
    """Two seasons, one firm, one issuance in each, and usage in the newer one."""

    @classmethod
    def setUpTestData(cls):
        cls.older = Season.objects.create(
            name='2024/2025', start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
        )
        cls.newer = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            is_active=True,
        )
        cls.firm = ExportFirm.objects.create(code='D11F', name_tk='Firma D11')

        cls.old_issuance = QuotaIssuance.objects.create(
            issue_date=cls.older.start_date, season=cls.older, product_type='tomato',
        )
        cls.old_alloc = QuotaIssuanceFirmAllocation.objects.create(
            issuance=cls.old_issuance, export_firm=cls.firm, kg_quota=Decimal('1000'),
        )
        cls.new_issuance = QuotaIssuance.objects.create(
            issue_date=cls.newer.start_date, season=cls.newer, product_type='tomato',
        )
        cls.new_alloc = QuotaIssuanceFirmAllocation.objects.create(
            issuance=cls.new_issuance, export_firm=cls.firm, kg_quota=Decimal('300'),
        )

        cls.admin = User.objects.create(
            username='d11-admin', role='admin', is_superuser=True,
        )

    def setUp(self):
        cache.clear()


class QuotaIssuanceDisplayScopingTests(QuotaSeasonFixture):
    """D11(a) — `quota-issuances` is season-scoped (spec §4.7, reversing §4.5)."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.manager = User.objects.create(username='d11-mgr', role='export_manager')
        RoleResourcePermission.objects.update_or_create(
            role='export_manager', resource_code='quota_issuance',
            defaults={'can_view': True},
        )

    def _list(self, user=None, query: str = '') -> list[int]:
        client = APIClient()
        client.force_authenticate(user=user or self.admin)
        response = client.get(f'/api/v1/export/quota-issuances/{query}')
        self.assertEqual(response.status_code, 200, response.content[:400])
        body = response.json()
        rows = body['results'] if isinstance(body, dict) and 'results' in body else body
        return [row['id'] for row in rows]

    def test_prior_season_issuance_is_hidden_by_default(self):
        """The exact assertion D10's opt-out test made in reverse: no `?season=`
        resolves to the active season, and a prior season's issuance must now
        drop out of the list."""
        ids = self._list()
        self.assertIn(self.new_issuance.pk, ids)
        self.assertNotIn(self.old_issuance.pk, ids)

    def test_prior_season_issuance_visible_when_that_season_is_selected(self):
        ids = self._list(query=f'?season={self.older.pk}')
        self.assertIn(self.old_issuance.pk, ids)
        self.assertNotIn(self.new_issuance.pk, ids)

    def test_closed_season_denied_without_permission(self):
        Season.objects.filter(pk=self.older.pk).update(closed_at=timezone.now())
        client = APIClient()
        client.force_authenticate(user=self.manager)
        self.assertEqual(
            client.get('/api/v1/export/quota-issuances/').status_code, 200,
            'unscoped request must succeed — otherwise the 403 below would be a '
            'resource-permission failure, not a season one',
        )
        response = client.get(f'/api/v1/export/quota-issuances/?season={self.older.pk}')
        self.assertEqual(response.status_code, 403)

    def test_unknown_season_returns_404(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.get('/api/v1/export/quota-issuances/?season=999999')
        self.assertEqual(response.status_code, 404)

    def test_no_active_season_returns_nothing(self):
        """D7 fail closed — during the close→open gap the list is empty, not
        every season's issuances at once."""
        Season.objects.filter(pk=self.newer.pk).update(is_active=False)
        self.assertEqual(self._list(), [])

    def test_detail_route_still_resolves_across_seasons(self):
        """Rule A — a direct link to a prior season's issuance must not 404."""
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.get(f'/api/v1/export/quota-issuances/{self.old_issuance.pk}/')
        self.assertEqual(response.status_code, 200)

    def test_issuance_with_no_season_is_invisible_everywhere(self):
        """Documented consequence, pinned so it cannot regress silently: an
        issuance whose `issue_date` falls in the gap between two seasons has
        `season = NULL` and is reachable by direct link only. QuotaIssuance#34
        on the live dev database is exactly this row.
        """
        orphan = QuotaIssuance.objects.create(
            issue_date=date(2026, 8, 15), season=None, product_type='tomato',
        )
        self.assertNotIn(orphan.pk, self._list())
        self.assertNotIn(orphan.pk, self._list(query=f'?season={self.older.pk}'))
        self.assertNotIn(orphan.pk, self._list(query=f'?season={self.newer.pk}'))


class QuotaIssuanceCreateDuringGapTests(QuotaSeasonFixture):
    """`perform_create` stamps `get_active_season()`, which is None during the
    close→open gap — before D11 that produced a harmless NULL, but now it
    produces a row invisible on every screen the moment it is saved.
    """

    def test_create_is_rejected_when_no_season_is_active(self):
        Season.objects.filter(pk=self.newer.pk).update(is_active=False)
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.post(
            '/api/v1/export/quota-issuances/',
            {
                'issue_date': '2026-09-15', 'product_type': 'tomato',
                'validity': 'this_month',
                'allocations': [{'export_firm': self.firm.pk, 'kg_quota': '500'}],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content[:400])
        self.assertEqual(
            QuotaIssuance.objects.filter(season__isnull=True).count(), 0,
            'no orphan issuance may be left behind by the rejected create',
        )


class FifoStopsAtTheSeasonBoundaryTests(QuotaSeasonFixture):
    """D11(b) — consumption. Directly reverses
    `QuotaIssuanceOptOutTests.test_fifo_usage_still_consumes_a_prior_seasons_allocation`.
    """

    def test_usage_does_not_consume_a_prior_seasons_allocation(self):
        """400 kg used in `newer` must draw on `newer`'s own 300 kg allocation
        and stop there — under D10 it consumed `older`'s 1000 kg first, because
        FIFO ordered by issue_date with no season predicate at all.
        """
        QuotaUsageRecord.objects.create(
            usage_date=self.newer.start_date, export_firm=self.firm,
            kg_used=Decimal('400'), product_type='tomato', status='approved',
        )
        result = compute_fifo_usage('tomato', self.newer)
        self.assertNotIn(
            self.old_alloc.pk, result,
            "a prior season's allocation must not appear in this season's ledger",
        )
        self.assertEqual(result[self.new_alloc.pk], Decimal('300'))

    def test_prior_seasons_ledger_is_computed_from_its_own_rows_only(self):
        QuotaUsageRecord.objects.create(
            usage_date=self.newer.start_date, export_firm=self.firm,
            kg_used=Decimal('400'), product_type='tomato', status='approved',
        )
        result = compute_fifo_usage('tomato', self.older)
        self.assertEqual(
            result[self.old_alloc.pk], Decimal('0'),
            'leftover issuance expires with its season rather than carrying forward',
        )
        self.assertNotIn(self.new_alloc.pk, result)

    def test_no_season_returns_nothing(self):
        self.assertEqual(compute_fifo_usage('tomato', None), {})

    def test_usage_anchors_on_its_shipments_season_not_its_date(self):
        """A usage row whose `usage_date` falls outside its own season's range
        (real: 7 rows on the dev DB dated July 2026, whose shipments belong to a
        season ending 2026-06-30) still belongs to its shipment's season.
        """
        country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        shipment = Shipment.objects.create(
            shipment_code='D11-SHIP', date=self.newer.start_date, season=self.newer,
            status=_make_status(), country=country,
        )
        QuotaUsageRecord.objects.create(
            # Deliberately outside BOTH seasons' date ranges.
            usage_date=date(2026, 9, 15), export_firm=self.firm, shipment=shipment,
            kg_used=Decimal('250'), product_type='tomato', status='approved',
        )
        result = compute_fifo_usage('tomato', self.newer)
        self.assertEqual(result[self.new_alloc.pk], Decimal('250'))

    def test_cache_is_keyed_by_season(self):
        """Without the season in the key, switching seasons serves the previous
        season's ledger for up to the 60s TTL — the exact bug the frontend query
        keys exist to prevent, one layer down.
        """
        QuotaUsageRecord.objects.create(
            usage_date=self.newer.start_date, export_firm=self.firm,
            kg_used=Decimal('400'), product_type='tomato', status='approved',
        )
        newer_result = compute_fifo_usage('tomato', self.newer)
        older_result = compute_fifo_usage('tomato', self.older)  # must not be a cache hit
        self.assertEqual(newer_result[self.new_alloc.pk], Decimal('300'))
        self.assertEqual(older_result[self.old_alloc.pk], Decimal('0'))


class FirmBalancesStopAtTheSeasonBoundaryTests(QuotaSeasonFixture):
    """`compute_firm_quota_balances` anchors on the `season` FK, not a date range."""

    def test_balance_counts_only_the_selected_seasons_issuance_and_usage(self):
        QuotaUsageRecord.objects.create(
            usage_date=self.newer.start_date, export_firm=self.firm,
            kg_used=Decimal('100'), product_type='tomato', status='approved',
        )
        QuotaUsageRecord.objects.create(
            usage_date=self.older.start_date, export_firm=self.firm,
            kg_used=Decimal('700'), product_type='tomato', status='approved',
        )
        # `today` pinned inside each issuance's validity window — the balance
        # drops lapsed allocations, and these fixtures sit a year apart.
        newer = compute_firm_quota_balances(
            'tomato', self.newer, today=date(2025, 9, 15),
        )[self.firm.pk]
        self.assertEqual(newer['issued_kg'], Decimal('300'))
        self.assertEqual(newer['used_kg'], Decimal('100'))
        self.assertEqual(newer['remaining_kg'], Decimal('200'))

        older = compute_firm_quota_balances(
            'tomato', self.older, today=date(2024, 9, 15),
        )[self.firm.pk]
        self.assertEqual(older['issued_kg'], Decimal('1000'))
        self.assertEqual(older['used_kg'], Decimal('700'))

    def test_issuance_dated_outside_its_own_season_still_counts_for_it(self):
        """The FK is authoritative, not `issue_date` — the previous
        implementation date-ranged the issuance side and would drop this row.
        """
        stray = QuotaIssuance.objects.create(
            # Inside `older`'s date range (its last day), but explicitly stamped
            # `newer`. `this_and_next` keeps it live alongside `new_alloc` on the
            # pinned date below, so expiry can't mask the FK question being asked.
            issue_date=self.older.end_date, season=self.newer, product_type='tomato',
            validity='this_and_next',
        )
        QuotaIssuanceFirmAllocation.objects.create(
            issuance=stray, export_firm=self.firm, kg_quota=Decimal('50'),
        )
        self.assertEqual(
            compute_firm_quota_balances(
                'tomato', self.newer, today=date(2025, 9, 15),
            )[self.firm.pk]['issued_kg'],
            Decimal('350'),
        )

    def test_no_season_returns_empty(self):
        self.assertEqual(compute_firm_quota_balances('tomato', None), {})


class QuotaUsageUnlinkedRowScopingTests(QuotaSeasonFixture):
    """The 575-row question: `QuotaUsageRecord.shipment` is nullable and those
    rows reach a season through nothing at all. Under D11 they must land in
    exactly ONE season — the one their `usage_date` falls in — not in every open
    season (the pre-D11 `include_null_link` behaviour) and not in none.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        RoleResourcePermission.objects.update_or_create(
            role='admin', resource_code='quota_usage',
            defaults={'can_view': True, 'can_edit': True},
        )
        cls.old_usage = QuotaUsageRecord.objects.create(
            usage_date=cls.older.start_date, export_firm=cls.firm,
            kg_used=Decimal('11'), product_type='tomato', status='approved',
        )
        cls.new_usage = QuotaUsageRecord.objects.create(
            usage_date=cls.newer.start_date, export_firm=cls.firm,
            kg_used=Decimal('22'), product_type='tomato', status='approved',
        )

    def _list(self, query: str = '') -> set[int]:
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.get(f'/api/v1/export/quota-usage/{query}')
        self.assertEqual(response.status_code, 200, response.content[:400])
        body = response.json()
        rows = body['results'] if isinstance(body, dict) and 'results' in body else body
        return {row['id'] for row in rows}

    def test_unlinked_row_appears_only_in_the_season_its_date_falls_in(self):
        ids = self._list()
        self.assertIn(self.new_usage.pk, ids)
        self.assertNotIn(
            self.old_usage.pk, ids,
            'pre-D11 include_null_link surfaced every unlinked row under every '
            'open season; under D11 it belongs to exactly one',
        )

    def test_unlinked_row_of_a_prior_season_appears_when_that_season_is_selected(self):
        ids = self._list(query=f'?season={self.older.pk}')
        self.assertIn(self.old_usage.pk, ids)
        self.assertNotIn(self.new_usage.pk, ids)

    def test_no_active_season_returns_nothing(self):
        Season.objects.filter(pk=self.newer.pk).update(is_active=False)
        self.assertEqual(self._list(), set())


class GapSeasonFixture(TestCase):
    """Two seasons with a REAL calendar gap between them, mirroring the dev DB:
    2025-2026 ends 2026-06-30, 2026-2027 starts 2026-08-01, so July 2026 belongs
    to no season. That gap is what makes a row unreachable.
    """

    @classmethod
    def setUpTestData(cls):
        cls.past = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 6, 30),
        )
        cls.current = Season.objects.create(
            name='2026/2027', start_date=date(2026, 8, 1), end_date=date(2027, 6, 30),
            is_active=True,
        )
        cls.firm = ExportFirm.objects.create(code='GAPF', name_tk='Firma GAP')
        cls.admin = User.objects.create(
            username='gap-admin', role='admin', is_superuser=True,
        )
        RoleResourcePermission.objects.update_or_create(
            role='admin', resource_code='quota_usage',
            defaults={'can_view': True, 'can_create': True, 'can_edit': True},
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)


class QuotaUsageMustResolveToASeasonTests(GapSeasonFixture):
    """Regression: D11 made it possible to write a usage row that belongs to no
    season and is therefore invisible everywhere and counted in no ledger.

    `QuotaUsageRecord.usage_date` and `.shipment` are BOTH writable
    (`QuotaUsageRecordSerializer.read_only_fields` excludes them), and the quota
    usage grid POSTs `{usage_date, export_firm, kg_used, product_type}` with no
    shipment at all. Before D11 an unlinked row surfaced under the active season
    via `include_null_link`, so a gap date was survivable; now it matches
    `usage_season_q()` for no season at all. Mirrors the guard already on
    `QuotaIssuanceViewSet.perform_create`.
    """

    URL = '/api/v1/export/quota-usage/'

    def _post(self, usage_date: str, shipment=None):
        payload = {
            'usage_date': usage_date, 'export_firm': self.firm.pk,
            'kg_used': '100', 'product_type': 'tomato',
        }
        if shipment is not None:
            payload['shipment'] = shipment.pk
        return self.client.post(self.URL, payload, format='json')

    def test_unlinked_row_dated_in_the_gap_is_rejected(self):
        response = self._post('2026-07-15')
        self.assertEqual(response.status_code, 400, response.content[:400])
        self.assertEqual(
            QuotaUsageRecord.objects.count(), 0,
            'no invisible row may be left behind by the rejected create',
        )

    def test_unlinked_row_inside_a_season_is_accepted(self):
        """Control — the guard must not reject legitimate writes."""
        self.assertEqual(self._post('2026-09-15').status_code, 201)
        self.assertEqual(self._post('2026-01-15').status_code, 201)

    def test_linked_row_dated_in_the_gap_is_accepted(self):
        """A shipment anchors the row regardless of its date, so a July-2026
        usage row against a season that ended 2026-06-30 is legitimate — 7 such
        rows exist on the dev DB. The guard must not reject them.
        """
        country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        shipment = Shipment.objects.create(
            shipment_code='GAP-SHIP', date=self.past.start_date, season=self.past,
            status=_make_status(), country=country,
        )
        response = self._post('2026-07-15', shipment=shipment)
        self.assertEqual(response.status_code, 201, response.content[:400])

    def test_patch_moving_an_unlinked_row_into_the_gap_is_rejected(self):
        created = self._post('2026-09-15')
        self.assertEqual(created.status_code, 201, created.content[:400])
        record_id = created.json()['id']
        response = self.client.patch(
            f'{self.URL}{record_id}/', {'usage_date': '2026-07-15'}, format='json',
        )
        self.assertEqual(response.status_code, 400, response.content[:400])
        self.assertEqual(
            QuotaUsageRecord.objects.get(pk=record_id).usage_date, date(2026, 9, 15),
            'the rejected PATCH must not have been applied',
        )


class IssuanceDetailUsesItsOwnSeasonsLedgerTests(GapSeasonFixture):
    """Detail routes deliberately bypass season scoping (Rule A), so a direct
    link to a prior season's issuance resolves — but `get_serializer_context`
    built `usage_map` from `resolve_season(request)`, which for an un-parameterised
    detail GET is the ACTIVE season. The row came back annotated with a different
    season's (empty) ledger: `used_kg: 0.00` where the truth is the full
    consumption.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        RoleResourcePermission.objects.update_or_create(
            role='admin', resource_code='quota_issuance', defaults={'can_view': True},
        )
        cls.past_issuance = QuotaIssuance.objects.create(
            issue_date=cls.past.start_date, season=cls.past, product_type='tomato',
        )
        cls.past_alloc = QuotaIssuanceFirmAllocation.objects.create(
            issuance=cls.past_issuance, export_firm=cls.firm, kg_quota=Decimal('1000'),
        )
        QuotaUsageRecord.objects.create(
            usage_date=cls.past.start_date, export_firm=cls.firm,
            kg_used=Decimal('600'), product_type='tomato', status='approved',
        )

    def test_detail_route_reports_its_own_seasons_consumption(self):
        response = self.client.get(f'/api/v1/export/quota-issuances/{self.past_issuance.pk}/')
        self.assertEqual(response.status_code, 200, response.content[:400])
        allocation = response.json()['allocations'][0]
        self.assertEqual(
            Decimal(str(allocation['used_kg'])), Decimal('600'),
            'used_kg must come from the ROW\'s season, not the resolved one — the '
            'active season has no quota at all, so resolving there reports 0',
        )

    def test_list_still_uses_the_resolved_season(self):
        """Control — the list must keep using the resolved season, or the
        consumed column would describe rows it is not showing."""
        response = self.client.get(f'/api/v1/export/quota-issuances/?season={self.past.pk}')
        self.assertEqual(response.status_code, 200, response.content[:400])
        body = response.json()
        rows = body['results'] if isinstance(body, dict) and 'results' in body else body
        self.assertEqual(Decimal(str(rows[0]['allocations'][0]['used_kg'])), Decimal('600'))
