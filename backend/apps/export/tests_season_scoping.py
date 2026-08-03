"""Season read-scoping across every scoped endpoint.

The table below IS the spec's §4.1/§4.2 checklist. An endpoint that scopes data
but is absent from ENDPOINTS is a leak; add it here when you add the mixin.

Run with:
    python manage.py test apps.export.tests_season_scoping --verbosity=2
"""
from datetime import date, timedelta

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.contracts.models import Contract
from apps.core.models import (
    Country, ExportFirm, GreenhouseBlock, ImportFirm, RoleResourcePermission,
    Season, ShipmentStatusType, TruckDestination, User,
)
from apps.export.models import (
    Shipment, ShipmentFirmSplit, WeeklyDestinationSelection, WeeklyLocalSellPlan,
    WeeklyTruckAllocation,
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
