"""Season read-scoping across every scoped endpoint.

The table below IS the spec's §4.1/§4.2 checklist. An endpoint that scopes data
but is absent from ENDPOINTS is a leak; add it here when you add the mixin.

Run with:
    python manage.py test apps.export.tests_season_scoping --verbosity=2
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.contracts.models import Contract, ContractSale
from apps.core.models import (
    Country, ExportFirm, GreenhouseBlock, ImportFirm, RoleResourcePermission,
    Season, ShipmentStatusType, TruckDestination, User,
)
from apps.export.models import (
    CustomsExpense, FinansistAdvance, FinansistAdvanceShipment, QuotaUsageRecord,
    Shipment, ShipmentComment, ShipmentFirmSplit, Task, TaskKind,
    WeeklyDestinationSelection, WeeklyLocalSellPlan, WeeklyTruckAllocation,
)
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan

# (url, factory_attr) — factory_attr names the setUpTestData helper that creates
# one row in a given season.
ENDPOINTS = [
    ('/api/v1/export/shipments/', 'make_shipment'),
    ('/api/v1/export/shipments/sheet/', 'make_shipment'),
    ('/api/v1/export/truck-allocations/', 'make_truck_allocation'),
    ('/api/v1/export/truck-destination-selections/', 'make_destination_selection'),
    ('/api/v1/export/local-sell-plans/', 'make_local_sell_plan'),
    ('/api/v1/greenhouse/harvest-plans/', 'make_harvest_plan'),
    ('/api/v1/greenhouse/day-entries/', 'make_day_entry'),
    ('/api/v1/contracts/contracts/', 'make_contract'),
    ('/api/v1/contracts/document-packets/', 'make_document_packet'),
]

# Task 6's six join-scoped endpoints (comments, tasks, quota-usage, advances,
# customs-expenses, contract sales) are intentionally NOT added to ENDPOINTS
# above: ScopedEndpointCoverageTests' `blocked` role needs the *unscoped*
# request to return 200 so a 403 on the closed-season request can only mean
# the season gate fired — but `blocked` (role='director') has no view
# permission on 'sale'/'advance'/'quota_usage' at all, so that precondition
# fails before the season check is ever exercised. Each gets its own dedicated
# test class below instead (JoinScopedEndpointTests, TaskJoinScopedEndpointTests,
# QuotaUsageJoinScopedEndpointTests, CustomsExpenseJoinScopedEndpointTests,
# ContractSaleJoinScopedEndpointTests, FinansistAdvanceJoinScopedEndpointTests) —
# still fully covered, just not through this generic harness.


def _make_status() -> ShipmentStatusType:
    return ShipmentStatusType.objects.create(
        code='draft', name_tk='Draft', phase='DRAFT', step_order=1,
    )


class SeasonScopingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        cls.status = _make_status()
        cls.country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')

        cls.manager = User.objects.create(username='mgr', role='export_manager')
        cls.manager.set_password('pass')
        cls.manager.save()
        cls.operator = User.objects.create(username='op', role='warehouse_chief')
        cls.operator.set_password('pass')
        cls.operator.save()
        # Holds closed_season.can_view but is NOT in _ARCHIVE_VIEW_ROLES — the
        # role that proves the two permissions stayed distinct (D8).
        cls.no_archive = User.objects.create(username='docs', role='document_team')
        cls.no_archive.set_password('pass')
        cls.no_archive.save()

        for role in ('export_manager', 'document_team'):
            RoleResourcePermission.objects.update_or_create(
                role=role, resource_code='closed_season',
                defaults={'can_view': True},
            )

        cls.active_shipment = cls.make_shipment(cls.active, 'ACT-001')
        cls.closed_shipment = cls.make_shipment(cls.closed, 'CLS-001')

    @classmethod
    def make_shipment(cls, season: Season, code: str) -> Shipment:
        return Shipment.objects.create(
            shipment_code=code, date=season.start_date, season=season,
            status=cls.status, country=cls.country,
        )

    def _login(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _codes(self, response) -> set[str]:
        # ShipmentListSerializer exposes the column as `shipment_code`, not `code`.
        results = response.json()
        rows = results['results'] if isinstance(results, dict) else results
        return {r['shipment_code'] for r in rows}

    def test_default_view_excludes_closed_season(self):
        response = self._login(self.manager).get('/api/v1/export/shipments/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('ACT-001', self._codes(response))
        self.assertNotIn('CLS-001', self._codes(response))

    def test_closed_season_visible_with_permission(self):
        response = self._login(self.manager).get(
            f'/api/v1/export/shipments/?season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('CLS-001', self._codes(response))
        self.assertNotIn('ACT-001', self._codes(response))

    def test_closed_season_denied_without_permission(self):
        response = self._login(self.operator).get(
            f'/api/v1/export/shipments/?season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 403)

    def test_unknown_season_returns_404(self):
        response = self._login(self.manager).get('/api/v1/export/shipments/?season=999999')
        self.assertEqual(response.status_code, 404)

    def _make_archived_closed_shipment(self) -> Shipment:
        archived = self.make_shipment(self.closed, 'CLS-ARCH')
        Shipment.objects.filter(pk=archived.pk).update(is_archived=True)
        return archived

    def test_closed_season_archive_bypass_for_archive_role(self):
        """Rule B / D8: inside a frozen season the operational-vs-archive split
        is meaningless, so it is bypassed — for a user who ALSO holds
        archive-view access. export_manager is in _ARCHIVE_VIEW_ROLES.
        """
        self._make_archived_closed_shipment()
        client = self._login(self.manager)

        self.assertNotIn('CLS-ARCH', self._codes(client.get('/api/v1/export/shipments/')))
        self.assertIn(
            'CLS-ARCH',
            self._codes(client.get(f'/api/v1/export/shipments/?season={self.closed.pk}')),
        )

    def test_closed_season_archive_bypass_needs_archive_permission(self):
        """D8 (spec §9.1): the bypass drops the default is_archived=False filter
        too, so granting closed_season.can_view must NOT silently confer
        archive-view. document_team holds closed_season but is not an archive
        role: it sees the closed season's non-archived rows and nothing more.
        """
        self._make_archived_closed_shipment()
        codes = self._codes(
            self._login(self.no_archive).get(
                f'/api/v1/export/shipments/?season={self.closed.pk}'
            )
        )
        self.assertNotIn('CLS-ARCH', codes)
        # Partial view, not an empty one — the season itself is still readable.
        self.assertIn('CLS-001', codes)

    def test_no_active_season_returns_nothing(self):
        """D7 (spec §3.1): during the close→open gap a scoped list returns
        nothing, not everything. Failing open here would expose every closed
        season to every user, ignoring closed_season.can_view entirely.
        """
        Season.objects.filter(pk=self.active.pk).update(is_active=False)
        response = self._login(self.manager).get('/api/v1/export/shipments/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._codes(response), set())

    def test_no_active_season_still_resolves_a_detail_route(self):
        """D7: detail routes bypass scoping, so direct links survive the gap."""
        Season.objects.filter(pk=self.active.pk).update(is_active=False)
        response = self._login(self.manager).get(
            f'/api/v1/export/shipments/{self.active_shipment.pk}/'
        )
        self.assertEqual(response.status_code, 200)

    def test_no_active_season_still_allows_explicit_season_select(self):
        """D7: the switcher keeps working — an explicit ?season= resolves."""
        Season.objects.filter(pk=self.active.pk).update(is_active=False)
        response = self._login(self.manager).get(
            f'/api/v1/export/shipments/?season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('CLS-001', self._codes(response))

    def test_detail_route_resolves_across_seasons(self):
        """Rule A: a direct link must resolve whichever season is selected.

        This is also what lets the (Task 9) write freeze answer 409 — if
        get_object() could not find a closed-season row it would 404 first.
        """
        response = self._login(self.manager).get(
            f'/api/v1/export/shipments/{self.closed_shipment.pk}/'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['shipment_code'], 'CLS-001')


class ScopedEndpointCoverageTests(TestCase):
    """One case per endpoint in ENDPOINTS — the §4.1/§4.2 leak checklist.

    `viewer` holds closed_season.can_view; `blocked` has the same resource
    rights but not that one, so a 403 here can only come from the season gate.
    Each denied case first asserts the *unscoped* request is 200, which rules
    out a resource-permission 403 masquerading as a season 403.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        cls.status = _make_status()
        cls.country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        cls.block = GreenhouseBlock.objects.create(code='A', name='Block A')
        cls.export_firm = ExportFirm.objects.create(code='EF1', name_tk='Firma')
        cls.import_firm = ImportFirm.objects.create(name_company='Buyer LLC')
        cls.destination = TruckDestination.objects.create(name='Almaty')

        cls.viewer = User.objects.create(username='viewer', role='admin')
        cls.blocked = User.objects.create(username='blocked', role='director')
        RoleResourcePermission.objects.update_or_create(
            role='admin', resource_code='closed_season', defaults={'can_view': True},
        )

        # dict.fromkeys de-dups while keeping order: two endpoints share
        # make_shipment, and calling it twice would collide on shipment_code.
        cls.rows = {
            factory: {
                season: getattr(cls, factory)(season)
                for season in (cls.active, cls.closed)
            }
            for factory in dict.fromkeys(factory for _, factory in ENDPOINTS)
        }

    # --- row factories: one row per season, each returns the created instance ---

    @classmethod
    def make_shipment(cls, season: Season) -> Shipment:
        return Shipment.objects.create(
            shipment_code=f'S-{season.pk}', date=season.start_date, season=season,
            status=cls.status, country=cls.country,
        )

    @classmethod
    def make_document_packet(cls, season: Season) -> Shipment:
        """A packet row is a shipment with at least one firm split."""
        shipment = Shipment.objects.create(
            shipment_code=f'P-{season.pk}', date=season.start_date, season=season,
            status=cls.status, country=cls.country,
        )
        ShipmentFirmSplit.objects.create(
            shipment=shipment, export_firm=cls.export_firm, weight_kg=1000,
        )
        return shipment

    @classmethod
    def make_truck_allocation(cls, season: Season) -> WeeklyTruckAllocation:
        return WeeklyTruckAllocation.objects.create(
            season=season, week_number=1, year=season.start_date.year, day_of_week=1,
        )

    @classmethod
    def make_destination_selection(cls, season: Season) -> WeeklyDestinationSelection:
        return WeeklyDestinationSelection.objects.create(
            season=season, destination=cls.destination,
            week_number=1, year=season.start_date.year,
        )

    @classmethod
    def make_local_sell_plan(cls, season: Season) -> WeeklyLocalSellPlan:
        return WeeklyLocalSellPlan.objects.create(
            season=season, export_firm=cls.export_firm,
            week_number=1, year=season.start_date.year,
        )

    @classmethod
    def make_harvest_plan(cls, season: Season) -> WeeklyHarvestPlan:
        return WeeklyHarvestPlan.objects.create(
            season=season, block=cls.block, week_number=1, year=season.start_date.year,
        )

    @classmethod
    def make_day_entry(cls, season: Season) -> HarvestDayEntry:
        plan = WeeklyHarvestPlan.objects.create(
            season=season, block=cls.block, week_number=2, year=season.start_date.year,
        )
        return HarvestDayEntry.objects.create(
            weekly_plan=plan, season=season, block=cls.block,
            entry_date=season.start_date, weekday=season.start_date.weekday(),
        )

    @classmethod
    def make_contract(cls, season: Season) -> Contract:
        return Contract.objects.create(
            contract_number=f'C-{season.pk}', season=season,
            export_firm=cls.export_firm, import_firm=cls.import_firm,
            status=Contract.STATUS_ACTIVE,
        )

    # --- helpers ---

    def _login(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _ids(self, response) -> set[int]:
        payload = response.json()
        rows = payload['results'] if isinstance(payload, dict) else payload
        return {row['id'] for row in rows}

    # --- the checklist ---

    def test_default_view_returns_only_the_active_season(self):
        client = self._login(self.viewer)
        for url, factory in ENDPOINTS:
            with self.subTest(url=url):
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                ids = self._ids(response)
                self.assertIn(self.rows[factory][self.active].pk, ids)
                self.assertNotIn(self.rows[factory][self.closed].pk, ids)

    def test_closed_season_param_swaps_the_scope(self):
        client = self._login(self.viewer)
        for url, factory in ENDPOINTS:
            with self.subTest(url=url):
                response = client.get(f'{url}?season={self.closed.pk}')
                self.assertEqual(response.status_code, 200)
                ids = self._ids(response)
                self.assertIn(self.rows[factory][self.closed].pk, ids)
                self.assertNotIn(self.rows[factory][self.active].pk, ids)

    def test_closed_season_denied_without_permission(self):
        client = self._login(self.blocked)
        for url, _ in ENDPOINTS:
            with self.subTest(url=url):
                self.assertEqual(
                    client.get(url).status_code, 200,
                    'unscoped request must succeed — otherwise the 403 below '
                    'would be a resource-permission failure, not a season one',
                )
                response = client.get(f'{url}?season={self.closed.pk}')
                self.assertEqual(response.status_code, 403)

    def test_unknown_season_returns_404(self):
        client = self._login(self.viewer)
        for url, _ in ENDPOINTS:
            with self.subTest(url=url):
                self.assertEqual(client.get(f'{url}?season=999999').status_code, 404)

    def test_no_active_season_returns_nothing_anywhere(self):
        """D7 (spec §3.1): fail closed on every scoped endpoint, not just
        shipments. An endpoint that still returns rows here is unfiltered.
        """
        Season.objects.filter(pk=self.active.pk).update(is_active=False)
        client = self._login(self.viewer)
        for url, _ in ENDPOINTS:
            with self.subTest(url=url):
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self._ids(response), set())

    def test_kanban_board_is_scoped(self):
        """The board groups by phase, so it has no flat `results` list."""
        client = self._login(self.viewer)
        active_code = self.rows['make_shipment'][self.active].shipment_code
        closed_code = self.rows['make_shipment'][self.closed].shipment_code

        def codes(response) -> set[str]:
            columns = response.json()['columns']  # {phase: [item, ...]}
            return {
                item['shipment_code']
                for items in columns.values()
                for item in items
            }

        default = client.get('/api/v1/export/shipments/board/')
        self.assertEqual(default.status_code, 200)
        self.assertIn(active_code, codes(default))
        self.assertNotIn(closed_code, codes(default))

        switched = client.get(f'/api/v1/export/shipments/board/?season={self.closed.pk}')
        self.assertEqual(switched.status_code, 200)
        self.assertIn(closed_code, codes(switched))
        self.assertNotIn(active_code, codes(switched))

        self.assertEqual(
            self._login(self.blocked)
            .get(f'/api/v1/export/shipments/board/?season={self.closed.pk}')
            .status_code,
            403,
        )

    def test_daily_harvest_board_is_scoped(self):
        """The daily board echoes the season it resolved."""
        client = self._login(self.viewer)
        default = client.get('/api/v1/greenhouse/daily-plan/')
        self.assertEqual(default.json()['season']['id'], self.active.pk)

        switched = client.get(f'/api/v1/greenhouse/daily-plan/?season={self.closed.pk}')
        self.assertEqual(switched.json()['season']['id'], self.closed.pk)

        denied = self._login(self.blocked).get(
            f'/api/v1/greenhouse/daily-plan/?season={self.closed.pk}'
        )
        self.assertEqual(denied.status_code, 403)

    def test_local_sell_plan_created_without_season_is_still_visible(self):
        """WeeklyLocalSellPlan.season is nullable and the serializer does not
        require it — a NULL-season row would vanish from the now-scoped list the
        moment it was created. The write target must be stamped on create.
        """
        client = self._login(self.viewer)
        created = client.post('/api/v1/export/local-sell-plans/', {
            'export_firm': self.export_firm.pk, 'week_number': 40, 'year': 2026,
        })
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()['season'], self.active.pk)
        self.assertIn(created.json()['id'], self._ids(client.get('/api/v1/export/local-sell-plans/')))

    def test_block_summary_is_scoped(self):
        """A sibling @action on a scoped viewset is part of that viewset.

        block-summary is the sharpest case: get_block_summary() falls back to a
        bare (year, week) date window when it gets no season, and seasons run
        Sept→Aug, so a past week IS the closed season — no ?season= needed. The
        endpoint carries only IsAuthenticated, so every operator could read
        closed-season per-block totals through it.
        """
        entry = self.rows['make_day_entry'][self.closed]
        iso_year, iso_week, _ = entry.entry_date.isocalendar()
        url = f'/api/v1/greenhouse/harvest-plans/block-summary/?year={iso_year}&week={iso_week}'

        def block_ids(response) -> set[int]:
            return {row['block_id'] for row in response.json()}

        # Default (active season) must not leak the closed season's week, even
        # though the requested week falls entirely inside that closed season.
        default = self._login(self.viewer).get(url)
        self.assertEqual(default.status_code, 200)
        self.assertNotIn(self.block.pk, block_ids(default))

        switched = self._login(self.viewer).get(f'{url}&season={self.closed.pk}')
        self.assertEqual(switched.status_code, 200)
        self.assertIn(self.block.pk, block_ids(switched))

        denied = self._login(self.blocked).get(f'{url}&season={self.closed.pk}')
        self.assertEqual(denied.status_code, 403)

    def test_clients_report_is_scoped(self):
        client = self._login(self.viewer)
        self.assertEqual(client.get('/api/v1/export/clients-report/').status_code, 200)
        self.assertEqual(
            client.get(f'/api/v1/export/clients-report/?season={self.closed.pk}').status_code,
            200,
        )
        denied = self._login(self.blocked).get(
            f'/api/v1/export/clients-report/?season={self.closed.pk}'
        )
        self.assertEqual(denied.status_code, 403)


class ExtraShipmentActionScopingTests(TestCase):
    """D9 — the three Shipment list-style actions that were absent from the plan.

    `overdue`, `my-sales-reports` and `my-pending-count` all build their
    queryset from `super().get_queryset()`, deliberately skipping the filters in
    `get_queryset()` — which means they skipped the season scope too. An
    operator's "overdue" list would otherwise show closed-season trucks forever.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        cls.country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        # 'bardy' is a SALES_PHASE_CODES status at step 9 — satisfies both the
        # overdue filter and my-sales-reports' step_order >= 4.
        cls.sales_status = ShipmentStatusType.objects.create(
            code='bardy', name_tk='Bardy', phase='SALES', step_order=9,
        )
        # document_team's pending window is LOADING/CUSTOMS.
        cls.loading_status = ShipmentStatusType.objects.create(
            code='yuklenme', name_tk='Yuklenme', phase='LOADING', step_order=1,
        )

        cls.manager = User.objects.create(username='mgr9', role='export_manager')
        cls.doc_team = User.objects.create(username='docs9', role='document_team')
        for role in ('export_manager', 'document_team'):
            RoleResourcePermission.objects.update_or_create(
                role=role, resource_code='closed_season', defaults={'can_view': True},
            )

        long_ago = timezone.now() - timedelta(days=60)
        cls.sales_rows = {}
        cls.pending_rows = {}
        for tag, season in (('ACT', cls.active), ('CLS', cls.closed)):
            sale = Shipment.objects.create(
                shipment_code=f'{tag}-SALE', date=season.start_date, season=season,
                status=cls.sales_status, country=cls.country,
            )
            # arrived_at drives days_overdue; set past the default 7-day threshold.
            Shipment.objects.filter(pk=sale.pk).update(arrived_at=long_ago)
            cls.sales_rows[season] = sale
            # documents_status left NULL → counts as pending for document_team.
            cls.pending_rows[season] = Shipment.objects.create(
                shipment_code=f'{tag}-PEND', date=season.start_date, season=season,
                status=cls.loading_status, country=cls.country,
            )

    def _login(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _codes(self, response) -> set[str]:
        payload = response.json()
        rows = payload['results'] if isinstance(payload, dict) else payload
        return {row['shipment_code'] for row in rows}

    def _assert_scoped(self, client, url: str) -> None:
        joiner = '&' if '?' in url else '?'
        default = client.get(url)
        self.assertEqual(default.status_code, 200, default.content)
        codes = self._codes(default)
        self.assertTrue(codes, f'{url} returned nothing for the active season')
        self.assertFalse(
            {c for c in codes if c.startswith('CLS-')},
            f'{url} leaked closed-season rows into the default view',
        )

        switched = client.get(f'{url}{joiner}season={self.closed.pk}')
        self.assertEqual(switched.status_code, 200)
        switched_codes = self._codes(switched)
        self.assertTrue({c for c in switched_codes if c.startswith('CLS-')})
        self.assertFalse({c for c in switched_codes if c.startswith('ACT-')})

    def test_overdue_is_scoped(self):
        self._assert_scoped(self._login(self.manager), '/api/v1/export/shipments/overdue/')

    def test_my_sales_reports_is_scoped(self):
        self._assert_scoped(
            self._login(self.manager), '/api/v1/export/shipments/my-sales-reports/',
        )

    def test_my_pending_count_is_scoped(self):
        client = self._login(self.doc_team)
        self.assertEqual(
            client.get('/api/v1/export/shipments/my-pending-count/').json()['count'], 1,
        )
        self.assertEqual(
            client.get(
                f'/api/v1/export/shipments/my-pending-count/?season={self.closed.pk}'
            ).json()['count'],
            1,
        )
        # Prove the two counts are not the same row: only the active-season row
        # may be reachable by default.
        Shipment.objects.filter(pk=self.pending_rows[self.closed].pk).delete()
        self.assertEqual(
            client.get('/api/v1/export/shipments/my-pending-count/').json()['count'], 1,
        )
        self.assertEqual(
            client.get(
                f'/api/v1/export/shipments/my-pending-count/?season={self.closed.pk}'
            ).json()['count'],
            0,
        )

    def test_no_active_season_returns_nothing(self):
        """D7 on these three actions too."""
        Season.objects.filter(pk=self.active.pk).update(is_active=False)
        client = self._login(self.manager)
        self.assertEqual(
            self._codes(client.get('/api/v1/export/shipments/overdue/')), set(),
        )
        self.assertEqual(
            self._codes(client.get('/api/v1/export/shipments/my-sales-reports/')), set(),
        )
        self.assertEqual(
            self._login(self.doc_team)
            .get('/api/v1/export/shipments/my-pending-count/')
            .json()['count'],
            0,
        )


# ---------------------------------------------------------------------------
# Task 6 — join-scoped endpoints (no season FK of their own; reach Season only
# through `shipment`). See task-6-brief.md and task-6-report.md.
# ---------------------------------------------------------------------------

class JoinScopedEndpointTests(SeasonScopingTests):
    """Child endpoints must inherit their shipment's season scope.

    ShipmentComment.shipment is required (never NULL), unlike the other five
    Task 6 viewsets — this is the "plain equality filter" case with no
    unlinked-row behaviour to prove.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.active_comment = ShipmentComment.objects.create(
            shipment=cls.active_shipment, user=cls.manager, content='active-note',
        )
        cls.closed_comment = ShipmentComment.objects.create(
            shipment=cls.closed_shipment, user=cls.manager, content='closed-note',
        )

    def _bodies(self, response) -> set[str]:
        payload = response.json()
        rows = payload['results'] if isinstance(payload, dict) else payload
        return {r['content'] for r in rows}

    def test_comments_exclude_closed_season_by_default(self):
        response = self._login(self.manager).get('/api/v1/export/comments/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('active-note', self._bodies(response))
        self.assertNotIn('closed-note', self._bodies(response))

    def test_comments_visible_when_closed_season_selected(self):
        response = self._login(self.manager).get(
            f'/api/v1/export/comments/?season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('closed-note', self._bodies(response))

    def test_comments_closed_season_denied_without_permission(self):
        """CommentViewSet is gated by DynamicResourcePermission
        (resource_code='shipment_comment'), unlike Task/CustomsExpense — so a
        403 here could be the missing *resource* permission instead of the
        missing closed_season grant. `self.operator` (warehouse_chief) has
        view rights on comments (RESOURCE_DEFAULTS) but no closed_season
        grant; asserting the unscoped request is 200 first rules out the
        wrong-reason 403.
        """
        client = self._login(self.operator)
        unscoped = client.get('/api/v1/export/comments/')
        self.assertEqual(
            unscoped.status_code, 200,
            'unscoped request must succeed — otherwise the 403 below would be '
            'a resource-permission failure, not a season one',
        )
        response = client.get(f'/api/v1/export/comments/?season={self.closed.pk}')
        self.assertEqual(response.status_code, 403)

    def test_shipment_pinned_comments_bypass_season_scope(self):
        """?shipment=<id> is the per-shipment comment drawer opened from a
        shipment's own detail page. `self.manager` holds closed_season.can_view
        (granted in SeasonScopingTests.setUpTestData), so this exercises the
        PRIVILEGED-pin branch: the drawer must not go silently empty for a
        user who could reach the same rows by selecting the season explicitly.
        See test_shipment_pinned_comments_denied_without_permission /
        test_shipment_pinned_comments_visible_for_active_season_without_permission
        for the non-privileged branch this does NOT exercise.
        """
        response = self._login(self.manager).get(
            f'/api/v1/export/comments/?shipment={self.closed_shipment.pk}'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('closed-note', self._bodies(response))

    def test_shipment_pinned_comments_denied_without_permission(self):
        """?season=<closed>&shipment=<id>: a non-privileged pin must still
        403, not silently fall through to 200 — resolve_season() has to run
        on the pin path, not just the season filter. `self.operator`
        (warehouse_chief) has view rights on comments but no closed_season
        grant.
        """
        response = self._login(self.operator).get(
            f'/api/v1/export/comments/?shipment={self.closed_shipment.pk}&season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 403)

    def test_shipment_pinned_comments_visible_for_active_season_without_permission(self):
        """The ordinary case: a non-privileged user pinning an ACTIVE-season
        shipment must still see its comments — the scoping branch (not the
        exemption) has to resolve to "visible" here, since the pinned
        shipment's season matches the resolved (default/active) season.
        """
        response = self._login(self.operator).get(
            f'/api/v1/export/comments/?shipment={self.active_shipment.pk}'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('active-note', self._bodies(response))

    def test_shipment_pinned_comments_gap_returns_nothing(self):
        """D7 on the pin path too: during the close→open gap, a pinned
        request must return nothing — even for a user who holds
        closed_season.can_view. The gap has no season to attribute the pin
        to, privileged or not.
        """
        Season.objects.filter(pk=self.active.pk).update(is_active=False)
        response = self._login(self.manager).get(
            f'/api/v1/export/comments/?shipment={self.active_shipment.pk}'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._bodies(response), set())


def _make_scoped_shipment(
    season: Season, code: str, country: Country, status: ShipmentStatusType,
) -> Shipment:
    """One shipment in `season`, for the nullable-anchor test classes below.

    Each class below creates its own season pair (not a shared TestCase base)
    so its fixtures stay readable in isolation and adding one doesn't inflate
    another's test count — see task-6-report.md for why these don't subclass
    SeasonScopingTests the way JoinScopedEndpointTests does.

    Takes `status` rather than calling `_make_status()` itself: ShipmentStatusType
    .code is unique, so a class needing 2+ shipments must create the status once
    and share it, not create-per-shipment.
    """
    return Shipment.objects.create(
        shipment_code=code, date=season.start_date, season=season,
        status=status, country=country,
    )


class TaskJoinScopedEndpointTests(TestCase):
    """Task.shipment is nullable — weekly_plan/local_sell_plan tasks carry none.

    A plain `shipment__season` equality filter is an inner join and would drop
    those rows from every season's list. `include_null_link` must keep them
    visible under the (open) active season and hide them the moment a closed
    season is explicitly selected.
    """

    @classmethod
    def setUpTestData(cls):
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        status = _make_status()
        cls.manager = User.objects.create(username='taskjoin_mgr', role='export_manager')
        RoleResourcePermission.objects.update_or_create(
            role='export_manager', resource_code='closed_season', defaults={'can_view': True},
        )
        # No closed_season grant — proves the 403 below is the season gate,
        # not TaskViewSet's own (nonexistent) resource permission.
        cls.blocked = User.objects.create(username='taskjoin_blocked', role='sales_rep')

        active_shipment = _make_scoped_shipment(cls.active, 'TJ-ACT', country, status)
        closed_shipment = _make_scoped_shipment(cls.closed, 'TJ-CLS', country, status)

        cls.active_task = Task.objects.create(
            shipment=active_shipment, title_key='t.active', assignee_role='export_manager',
        )
        cls.closed_task = Task.objects.create(
            shipment=closed_shipment, title_key='t.closed', assignee_role='export_manager',
        )
        cls.null_task = Task.objects.create(
            kind=TaskKind.WEEKLY_PLAN, title_key='t.weekly', assignee_role='export_manager',
        )

    def _login(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _title_keys(self, response) -> set[str]:
        payload = response.json()
        rows = payload['results'] if isinstance(payload, dict) else payload
        return {r['title_key'] for r in rows}

    def test_default_view_includes_null_shipment_task_excludes_closed(self):
        titles = self._title_keys(self._login(self.manager).get('/api/v1/export/tasks/'))
        self.assertIn('t.active', titles)
        self.assertIn('t.weekly', titles)
        self.assertNotIn('t.closed', titles)

    def test_closed_season_selected_hides_null_shipment_task(self):
        titles = self._title_keys(
            self._login(self.manager).get(f'/api/v1/export/tasks/?season={self.closed.pk}')
        )
        self.assertIn('t.closed', titles)
        self.assertNotIn('t.active', titles)
        self.assertNotIn('t.weekly', titles)

    def test_shipment_pinned_tasks_bypass_season_scope(self):
        """?shipment=<id> is that shipment's own tasks panel. `self.manager`
        holds closed_season.can_view (granted above), so this exercises the
        PRIVILEGED-pin branch only — see the _denied_/_visible_for_active_
        /_gap_ tests below for the non-privileged and gap branches.
        """
        closed_shipment_id = self.closed_task.shipment_id
        titles = self._title_keys(
            self._login(self.manager).get(f'/api/v1/export/tasks/?shipment={closed_shipment_id}')
        )
        self.assertIn('t.closed', titles)

    def test_shipment_pinned_tasks_denied_without_permission(self):
        """?season=<closed>&shipment=<id>: a non-privileged pin must still
        403 — resolve_season() has to run on the pin path, not just the
        season filter.
        """
        closed_shipment_id = self.closed_task.shipment_id
        response = self._login(self.blocked).get(
            f'/api/v1/export/tasks/?shipment={closed_shipment_id}&season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 403)

    def test_shipment_pinned_tasks_visible_for_active_season_without_permission(self):
        """Ordinary case: a non-privileged user pinning an ACTIVE-season
        shipment must still see its tasks.
        """
        active_shipment_id = self.active_task.shipment_id
        titles = self._title_keys(
            self._login(self.blocked).get(f'/api/v1/export/tasks/?shipment={active_shipment_id}')
        )
        self.assertIn('t.active', titles)

    def test_shipment_pinned_tasks_gap_returns_nothing(self):
        """D7 on the pin path: during the close→open gap a pinned request
        must return nothing, even for a privileged user.
        """
        Season.objects.filter(pk=self.active.pk).update(is_active=False)
        active_shipment_id = self.active_task.shipment_id
        titles = self._title_keys(
            self._login(self.manager).get(f'/api/v1/export/tasks/?shipment={active_shipment_id}')
        )
        self.assertEqual(titles, set())

    def test_closed_season_denied_without_permission(self):
        client = self._login(self.blocked)
        unscoped = client.get('/api/v1/export/tasks/')
        self.assertEqual(
            unscoped.status_code, 200,
            'unscoped request must succeed — otherwise the 403 below would be '
            'a resource-permission failure, not a season one (TaskViewSet has '
            'no resource_code gate, so this should always be 200)',
        )
        response = client.get(f'/api/v1/export/tasks/?season={self.closed.pk}')
        self.assertEqual(response.status_code, 403)


class QuotaUsageJoinScopedEndpointTests(TestCase):
    """QuotaUsageRecord.shipment is nullable ("null for imported historical
    records"). Same include_null_link rule as Task.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        status = _make_status()
        cls.export_firm = ExportFirm.objects.create(code='QUJ1', name_tk='Firma')
        cls.admin = User.objects.create(username='quotajoin_admin', role='admin')
        RoleResourcePermission.objects.update_or_create(
            role='admin', resource_code='closed_season', defaults={'can_view': True},
        )
        # director has full CRUD on quota_usage by default (seed_permissions)
        # but no closed_season grant — proves the 403 below is the season
        # gate, not the quota_usage resource gate.
        cls.blocked = User.objects.create(username='quotajoin_blocked', role='director')

        active_shipment = _make_scoped_shipment(cls.active, 'QUJ-ACT', country, status)
        closed_shipment = _make_scoped_shipment(cls.closed, 'QUJ-CLS', country, status)

        cls.active_row = QuotaUsageRecord.objects.create(
            usage_date=cls.active.start_date, export_firm=cls.export_firm,
            kg_used=Decimal('1000'), shipment=active_shipment, notes='active-row',
        )
        cls.closed_row = QuotaUsageRecord.objects.create(
            usage_date=cls.closed.start_date, export_firm=cls.export_firm,
            kg_used=Decimal('2000'), shipment=closed_shipment, notes='closed-row',
        )
        cls.historical_row = QuotaUsageRecord.objects.create(
            usage_date=cls.closed.start_date, export_firm=cls.export_firm,
            kg_used=Decimal('3000'), shipment=None, notes='historical-row',
        )

    def _login(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _notes(self, response) -> set[str]:
        # pagination_class = None on this viewset — a bare list, not a page dict.
        payload = response.json()
        rows = payload['results'] if isinstance(payload, dict) else payload
        return {r['notes'] for r in rows}

    def test_default_view_includes_historical_excludes_closed(self):
        notes = self._notes(self._login(self.admin).get('/api/v1/export/quota-usage/'))
        self.assertIn('active-row', notes)
        self.assertIn('historical-row', notes)
        self.assertNotIn('closed-row', notes)

    def test_closed_season_selected_hides_historical_row(self):
        notes = self._notes(
            self._login(self.admin).get(f'/api/v1/export/quota-usage/?season={self.closed.pk}')
        )
        self.assertIn('closed-row', notes)
        self.assertNotIn('active-row', notes)
        self.assertNotIn('historical-row', notes)

    def test_closed_season_denied_without_permission(self):
        client = self._login(self.blocked)
        unscoped = client.get('/api/v1/export/quota-usage/')
        self.assertEqual(
            unscoped.status_code, 200,
            'unscoped request must succeed — otherwise the 403 below would be '
            'a resource-permission failure, not a season one',
        )
        response = client.get(f'/api/v1/export/quota-usage/?season={self.closed.pk}')
        self.assertEqual(response.status_code, 403)


class CustomsExpenseJoinScopedEndpointTests(TestCase):
    """CustomsExpense.shipment is nullable ("null for batch fees"). Same
    include_null_link rule as Task/QuotaUsageRecord.
    """

    @classmethod
    def setUpTestData(cls):
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        status = _make_status()
        cls.creator = User.objects.create(username='cej_creator', role='export_manager')
        RoleResourcePermission.objects.update_or_create(
            role='export_manager', resource_code='closed_season', defaults={'can_view': True},
        )
        # No closed_season grant — CustomsExpenseViewSet has no resource_code
        # gate, so this proves the 403 below is the season gate.
        cls.blocked = User.objects.create(username='cej_blocked', role='sales_rep')

        active_shipment = _make_scoped_shipment(cls.active, 'CEJ-ACT', country, status)
        closed_shipment = _make_scoped_shipment(cls.closed, 'CEJ-CLS', country, status)

        cls.active_row = CustomsExpense.objects.create(
            expense_date=cls.active.start_date, category='OTHER', amount=Decimal('10'),
            shipment=active_shipment, created_by=cls.creator, label_raw='active-row',
        )
        cls.closed_row = CustomsExpense.objects.create(
            expense_date=cls.closed.start_date, category='OTHER', amount=Decimal('20'),
            shipment=closed_shipment, created_by=cls.creator, label_raw='closed-row',
        )
        cls.batch_row = CustomsExpense.objects.create(
            expense_date=cls.closed.start_date, category='KARANTIN', amount=Decimal('30'),
            shipment=None, quantity=19, created_by=cls.creator, label_raw='batch-row',
        )

    def _login(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _labels(self, response) -> set[str]:
        payload = response.json()
        rows = payload['results'] if isinstance(payload, dict) else payload
        return {r['label_raw'] for r in rows}

    def test_default_view_includes_batch_row_excludes_closed(self):
        labels = self._labels(self._login(self.creator).get('/api/v1/export/customs-expenses/'))
        self.assertIn('active-row', labels)
        self.assertIn('batch-row', labels)
        self.assertNotIn('closed-row', labels)

    def test_closed_season_selected_hides_batch_row(self):
        labels = self._labels(
            self._login(self.creator).get(
                f'/api/v1/export/customs-expenses/?season={self.closed.pk}'
            )
        )
        self.assertIn('closed-row', labels)
        self.assertNotIn('active-row', labels)
        self.assertNotIn('batch-row', labels)

    def test_shipment_pinned_expenses_bypass_season_scope(self):
        """?shipment=<id> is that shipment's own expenses panel. `self.creator`
        holds closed_season.can_view (granted above), so this exercises the
        PRIVILEGED-pin branch only — see the _denied_/_visible_for_active_
        /_gap_ tests below for the non-privileged and gap branches.
        """
        closed_shipment_id = self.closed_row.shipment_id
        labels = self._labels(
            self._login(self.creator).get(
                f'/api/v1/export/customs-expenses/?shipment={closed_shipment_id}'
            )
        )
        self.assertIn('closed-row', labels)

    def test_shipment_pinned_expenses_denied_without_permission(self):
        """?season=<closed>&shipment=<id>: a non-privileged pin must still
        403 — resolve_season() has to run on the pin path, not just the
        season filter.
        """
        closed_shipment_id = self.closed_row.shipment_id
        response = self._login(self.blocked).get(
            f'/api/v1/export/customs-expenses/?shipment={closed_shipment_id}&season={self.closed.pk}'
        )
        self.assertEqual(response.status_code, 403)

    def test_shipment_pinned_expenses_visible_for_active_season_without_permission(self):
        """Ordinary case: a non-privileged user pinning an ACTIVE-season
        shipment must still see its expenses.
        """
        active_shipment_id = self.active_row.shipment_id
        labels = self._labels(
            self._login(self.blocked).get(
                f'/api/v1/export/customs-expenses/?shipment={active_shipment_id}'
            )
        )
        self.assertIn('active-row', labels)

    def test_shipment_pinned_expenses_gap_returns_nothing(self):
        """D7 on the pin path: during the close→open gap a pinned request
        must return nothing, even for a privileged user.
        """
        Season.objects.filter(pk=self.active.pk).update(is_active=False)
        active_shipment_id = self.active_row.shipment_id
        labels = self._labels(
            self._login(self.creator).get(
                f'/api/v1/export/customs-expenses/?shipment={active_shipment_id}'
            )
        )
        self.assertEqual(labels, set())

    def test_closed_season_denied_without_permission(self):
        client = self._login(self.blocked)
        unscoped = client.get('/api/v1/export/customs-expenses/')
        self.assertEqual(
            unscoped.status_code, 200,
            'unscoped request must succeed — otherwise the 403 below would be '
            'a resource-permission failure, not a season one (CustomsExpenseViewSet '
            'has no resource_code gate, so this should always be 200)',
        )
        response = client.get(f'/api/v1/export/customs-expenses/?season={self.closed.pk}')
        self.assertEqual(response.status_code, 403)


class ContractSaleJoinScopedEndpointTests(TestCase):
    """ContractSale.shipment is nullable — legacy 2-Sales rows imported before
    the shipment bridge was populated (ADR-023). Same include_null_link rule.
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        status = _make_status()
        export_firm = ExportFirm.objects.create(code='CSJ1', name_tk='Firma')
        import_firm = ImportFirm.objects.create(name_company='Buyer CSJ')
        cls.admin = User.objects.create(username='csjoin_admin', role='admin')
        RoleResourcePermission.objects.update_or_create(
            role='admin', resource_code='closed_season', defaults={'can_view': True},
        )
        # director has full view+create+edit on 'sale' by default (seed_permissions)
        # but no closed_season grant — proves the 403 below is the season gate.
        cls.blocked = User.objects.create(username='csjoin_blocked', role='director')

        active_shipment = _make_scoped_shipment(cls.active, 'CSJ-ACT', country, status)
        closed_shipment = _make_scoped_shipment(cls.closed, 'CSJ-CLS', country, status)
        contract = Contract.objects.create(
            contract_number='CSJ-0001', export_firm=export_firm, import_firm=import_firm,
        )

        cls.active_row = ContractSale.objects.create(
            contract=contract, shipment=active_shipment, invoice_number=1,
        )
        cls.closed_row = ContractSale.objects.create(
            contract=contract, shipment=closed_shipment, invoice_number=2,
        )
        cls.legacy_row = ContractSale.objects.create(
            contract=contract, shipment=None, invoice_number=3,
        )

    def _login(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _invoice_numbers(self, response) -> set[int]:
        payload = response.json()
        rows = payload['results'] if isinstance(payload, dict) else payload
        return {r['invoice_number'] for r in rows}

    def test_default_view_includes_legacy_row_excludes_closed(self):
        numbers = self._invoice_numbers(self._login(self.admin).get('/api/v1/contracts/sales/'))
        self.assertIn(1, numbers)
        self.assertIn(3, numbers)
        self.assertNotIn(2, numbers)

    def test_closed_season_selected_hides_legacy_row(self):
        numbers = self._invoice_numbers(
            self._login(self.admin).get(f'/api/v1/contracts/sales/?season={self.closed.pk}')
        )
        self.assertIn(2, numbers)
        self.assertNotIn(1, numbers)
        self.assertNotIn(3, numbers)

    def test_closed_season_denied_without_permission(self):
        client = self._login(self.blocked)
        unscoped = client.get('/api/v1/contracts/sales/')
        self.assertEqual(
            unscoped.status_code, 200,
            'unscoped request must succeed — otherwise the 403 below would be '
            'a resource-permission failure, not a season one',
        )
        response = client.get(f'/api/v1/contracts/sales/?season={self.closed.pk}')
        self.assertEqual(response.status_code, 403)


class FinansistAdvanceJoinScopedEndpointTests(TestCase):
    """FinansistAdvance has no `shipment` FK of its own — only via the
    FinansistAdvanceShipment junction (zero to many). Proves:
      1. the season filter (Exists-based, not a join) still excludes closed;
      2. a zero-link advance plays "unlinked" and surfaces under an open season;
      3. scoping does NOT corrupt the shipment_count_ann/allocated_total_ann
         aggregates already on the queryset (the exact risk Exists avoids).
    """

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.active = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        cls.closed = Season.objects.create(
            name='2025/2026', start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
            closed_at=timezone.now(),
        )
        country = Country.objects.create(name_en='Kazakhstan', name_tk='Gazagystan')
        status = _make_status()
        cls.admin = User.objects.create(username='finjoin_admin', role='admin')
        RoleResourcePermission.objects.update_or_create(
            role='admin', resource_code='closed_season', defaults={'can_view': True},
        )
        # director has full CRUD on 'advance' by default (seed_permissions)
        # but no closed_season grant — proves the 403 below is the season gate.
        cls.blocked = User.objects.create(username='finjoin_blocked', role='director')

        active_shipment_1 = _make_scoped_shipment(cls.active, 'FAJ-ACT1', country, status)
        active_shipment_2 = _make_scoped_shipment(cls.active, 'FAJ-ACT2', country, status)
        closed_shipment = _make_scoped_shipment(cls.closed, 'FAJ-CLS', country, status)

        # Two links, both in the active season — proves shipment_count_ann
        # survives the season filter.
        cls.active_advance = FinansistAdvance.objects.create(
            batch_code='ADV-ACT', advance_date=cls.active.start_date,
            total_amount=Decimal('500'), issued_by=cls.admin,
        )
        FinansistAdvanceShipment.objects.create(
            advance=cls.active_advance, shipment=active_shipment_1,
        )
        FinansistAdvanceShipment.objects.create(
            advance=cls.active_advance, shipment=active_shipment_2,
        )

        cls.closed_advance = FinansistAdvance.objects.create(
            batch_code='ADV-CLS', advance_date=cls.closed.start_date,
            total_amount=Decimal('700'), issued_by=cls.admin,
        )
        FinansistAdvanceShipment.objects.create(
            advance=cls.closed_advance, shipment=closed_shipment,
        )

        # Zero links at all — plays the role of "unlinked".
        cls.unlinked_advance = FinansistAdvance.objects.create(
            batch_code='ADV-NOLINK', advance_date=cls.active.start_date,
            total_amount=Decimal('900'), issued_by=cls.admin,
        )

    def _login(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _rows_by_code(self, response) -> dict[str, dict]:
        payload = response.json()
        rows = payload['results'] if isinstance(payload, dict) else payload
        return {r['batch_code']: r for r in rows}

    def test_default_view_includes_unlinked_excludes_closed(self):
        rows = self._rows_by_code(self._login(self.admin).get('/api/v1/export/advances/'))
        self.assertIn('ADV-ACT', rows)
        self.assertIn('ADV-NOLINK', rows)
        self.assertNotIn('ADV-CLS', rows)

    def test_closed_season_selected_hides_unlinked(self):
        rows = self._rows_by_code(
            self._login(self.admin).get(f'/api/v1/export/advances/?season={self.closed.pk}')
        )
        self.assertIn('ADV-CLS', rows)
        self.assertNotIn('ADV-ACT', rows)
        self.assertNotIn('ADV-NOLINK', rows)

    def test_shipment_count_annotation_survives_season_scoping(self):
        """The exact regression Exists() is meant to prevent: a join-based
        `shipment_links__shipment__season` filter would multiply rows and
        corrupt this Count annotation.
        """
        rows = self._rows_by_code(self._login(self.admin).get('/api/v1/export/advances/'))
        self.assertEqual(rows['ADV-ACT']['shipment_count'], 2)

    def test_closed_season_denied_without_permission(self):
        client = self._login(self.blocked)
        unscoped = client.get('/api/v1/export/advances/')
        self.assertEqual(
            unscoped.status_code, 200,
            'unscoped request must succeed — otherwise the 403 below would be '
            'a resource-permission failure, not a season one',
        )
        response = client.get(f'/api/v1/export/advances/?season={self.closed.pk}')
        self.assertEqual(response.status_code, 403)
