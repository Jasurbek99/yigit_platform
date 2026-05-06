"""Tests for GET /api/v1/export/shipments/board/ (Stream D3).

Coverage:
  - Returns 7 phase keys including PLAN (which is empty)
  - Shipments grouped correctly by phase based on status code
  - Filters: country, customer, gapy_satys, owner_role, search work
  - Sort within column: late first, then active, by time_in_phase desc
  - phase_avg_seconds returned for each phase (or null where no historical data)
  - assertNumQueries <= 8 at 100 shipments
  - Auth: anonymous -> 401
"""
import datetime

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Country, Customer, Season, ShipmentStatusType, User
from apps.export.models import (
    Shipment,
    Task,
    TaskCompletionRule,
    TaskRule,
    TaskState,
)
from apps.export.services.phases import PHASE_ORDER

BOARD_URL = '/api/v1/export/shipments/board/'


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_user(username: str, role: str = 'export_manager') -> User:
    user = User(username=username, role=role)
    user.set_password('pass')
    user.save()
    return user


def _make_season(name: str = 'brd-test', is_active: bool = True) -> Season:
    """Create or retrieve a season. name MUST be <= 10 chars (Season.name max_length=10)."""
    assert len(name) <= 10, f"Season name '{name}' exceeds max_length=10"
    season, _ = Season.objects.get_or_create(
        name=name,
        defaults={
            'start_date': '2025-09-01',
            'end_date': '2026-06-30',
            'is_active': is_active,
        },
    )
    if season.is_active != is_active:
        season.is_active = is_active
        season.save(update_fields=['is_active'])
    return season


def _make_status(code: str, step_order: int = 1) -> ShipmentStatusType:
    st, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code,
            'name_en': code,
            'step_order': step_order,
            'phase': 'LOADING',
        },
    )
    return st


def _make_country(name: str, code: str) -> Country:
    """code must be unique across the test DB (max_length=5, unique=True)."""
    country, _ = Country.objects.get_or_create(
        code=code,
        defaults={'name_tk': name, 'name_en': name, 'name_ru': name},
    )
    return country


def _make_customer(name: str) -> Customer:
    customer, _ = Customer.objects.get_or_create(name=name)
    return customer


def _make_shipment(
    cargo_code: str,
    status_code: str = 'yuklenme',
    step_order: int = 1,
    season: Season | None = None,
    country: Country | None = None,
    customer: Customer | None = None,
    is_archived: bool = False,
    is_gapy_satys: bool = False,
) -> Shipment:
    if season is None:
        season = _make_season()
    st = _make_status(status_code, step_order)
    shipment, _ = Shipment.objects.get_or_create(
        cargo_code=cargo_code,
        defaults={
            'date': '2026-01-15',
            'season': season,
            'status': st,
            'country': country,
            'customer': customer,
            'is_archived': is_archived,
            'is_gapy_satys': is_gapy_satys,
        },
    )
    # Ensure mutable fields match (get_or_create returns existing row unchanged).
    changed = []
    if shipment.status_id != st.pk:
        shipment.status = st
        changed.append('status')
    if country and shipment.country_id != country.pk:
        shipment.country = country
        changed.append('country_id')
    if customer and shipment.customer_id != customer.pk:
        shipment.customer = customer
        changed.append('customer_id')
    if shipment.is_archived != is_archived:
        shipment.is_archived = is_archived
        changed.append('is_archived')
    if shipment.is_gapy_satys != is_gapy_satys:
        shipment.is_gapy_satys = is_gapy_satys
        changed.append('is_gapy_satys')
    if changed:
        shipment.save(update_fields=changed)
    return shipment


def _make_task(
    shipment: Shipment,
    assignee_role: str = 'warehouse_chief',
    state: str = TaskState.OPEN,
    deadline: datetime.datetime | None = None,
) -> Task:
    return Task.objects.create(
        shipment=shipment,
        step=shipment.status.code,
        title_key='tasks.test',
        assignee_role=assignee_role,
        completion_rule=TaskCompletionRule.MANUAL_DONE,
        state=state,
        deadline=deadline,
    )


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------

class BoardAuthTests(TestCase):
    """Unauthenticated request returns 401."""

    def test_anonymous_returns_401(self) -> None:
        client = APIClient()
        resp = client.get(BOARD_URL)
        self.assertEqual(resp.status_code, 401)


# ---------------------------------------------------------------------------
# Response structure
# ---------------------------------------------------------------------------

class BoardStructureTests(TestCase):
    """The board endpoint returns the correct top-level structure."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('brd_struct_user')
        cls.season = _make_season('brd-str')  # <= 10 chars
        _make_shipment('BRD001', status_code='yuklenme', season=cls.season)

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.user)

    def test_returns_200(self) -> None:
        resp = self.client.get(BOARD_URL)
        self.assertEqual(resp.status_code, 200)

    def test_top_level_keys_present(self) -> None:
        resp = self.client.get(BOARD_URL)
        data = resp.json()
        self.assertIn('phases', data)
        self.assertIn('columns', data)
        self.assertIn('phase_avg_seconds', data)

    def test_phases_list_contains_all_7_phases(self) -> None:
        resp = self.client.get(BOARD_URL)
        data = resp.json()
        self.assertEqual(set(data['phases']), set(PHASE_ORDER))
        self.assertEqual(len(data['phases']), 7)

    def test_columns_has_all_7_phase_keys(self) -> None:
        resp = self.client.get(BOARD_URL)
        data = resp.json()
        self.assertEqual(set(data['columns'].keys()), set(PHASE_ORDER))

    def test_plan_column_is_empty(self) -> None:
        """PLAN is a virtual phase — no real shipment is ever in it."""
        resp = self.client.get(BOARD_URL)
        data = resp.json()
        self.assertEqual(data['columns']['PLAN'], [])

    def test_phase_avg_seconds_has_all_7_keys(self) -> None:
        resp = self.client.get(BOARD_URL)
        data = resp.json()
        avgs = data['phase_avg_seconds']
        self.assertEqual(set(avgs.keys()), set(PHASE_ORDER))

    def test_phase_avg_seconds_values_are_int_or_null(self) -> None:
        resp = self.client.get(BOARD_URL)
        data = resp.json()
        for phase, val in data['phase_avg_seconds'].items():
            self.assertIn(
                type(val),
                (int, type(None)),
                f"phase_avg_seconds[{phase}] = {val!r} is neither int nor null",
            )


# ---------------------------------------------------------------------------
# Phase grouping
# ---------------------------------------------------------------------------

class BoardPhaseGroupingTests(TestCase):
    """Shipments appear in the correct phase column based on status code."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('brd_group_user')
        cls.season = _make_season('brd-grp')  # <= 10 chars
        # One shipment in each representative phase.
        cls.prep_ship    = _make_shipment('BRD_PREP',    'draft',         season=cls.season)
        cls.load_ship    = _make_shipment('BRD_LOAD',    'yuklenme',      season=cls.season)
        cls.docs_ship    = _make_shipment('BRD_DOCS',    'gumruk_girish', season=cls.season)
        cls.transit_ship = _make_shipment('BRD_TRANSIT', 'yola_chykdy',   season=cls.season)
        cls.dest_ship    = _make_shipment('BRD_DEST',    'bardy',         season=cls.season)
        cls.close_ship   = _make_shipment('BRD_CLOSE',   'tamamlandy',    season=cls.season)

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.user)

    def _get_column_codes(self, phase: str) -> set[str]:
        resp = self.client.get(BOARD_URL)
        self.assertEqual(resp.status_code, 200)
        items = resp.json()['columns'][phase]
        return {item['cargo_code'] for item in items}

    def test_draft_status_in_prep_column(self) -> None:
        codes = self._get_column_codes('PREP')
        self.assertIn('BRD_PREP', codes)

    def test_yuklenme_status_in_load_column(self) -> None:
        codes = self._get_column_codes('LOAD')
        self.assertIn('BRD_LOAD', codes)

    def test_gumruk_girish_status_in_docs_column(self) -> None:
        codes = self._get_column_codes('DOCS')
        self.assertIn('BRD_DOCS', codes)

    def test_yola_chykdy_status_in_transit_column(self) -> None:
        codes = self._get_column_codes('TRANSIT')
        self.assertIn('BRD_TRANSIT', codes)

    def test_bardy_status_in_dest_column(self) -> None:
        codes = self._get_column_codes('DEST')
        self.assertIn('BRD_DEST', codes)

    def test_tamamlandy_status_in_close_column(self) -> None:
        codes = self._get_column_codes('CLOSE')
        self.assertIn('BRD_CLOSE', codes)

    def test_archived_shipment_excluded(self) -> None:
        archived = _make_shipment(
            'BRD_ARCH', 'yuklenme', is_archived=True, season=self.season,
        )
        resp = self.client.get(BOARD_URL)
        all_codes = {
            item['cargo_code']
            for items in resp.json()['columns'].values()
            for item in items
        }
        self.assertNotIn(archived.cargo_code, all_codes)

    def test_inactive_season_excluded(self) -> None:
        inactive = _make_season('brd-inact', is_active=False)  # <= 10 chars
        other = _make_shipment('BRD_INACT', 'yuklenme', season=inactive)
        resp = self.client.get(BOARD_URL)
        all_codes = {
            item['cargo_code']
            for items in resp.json()['columns'].values()
            for item in items
        }
        self.assertNotIn(other.cargo_code, all_codes)


# ---------------------------------------------------------------------------
# Item fields
# ---------------------------------------------------------------------------

class BoardItemFieldTests(TestCase):
    """Each board item has the expected fields with correct types."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('brd_fields_user')
        cls.season = _make_season('brd-flds')  # <= 10 chars
        cls.shipment = _make_shipment('BRDF001', 'yuklenme', season=cls.season)
        # late task: past deadline, open
        cls.late_task = _make_task(
            cls.shipment,
            state=TaskState.OPEN,
            deadline=timezone.now() - datetime.timedelta(hours=2),
        )
        # done task
        cls.done_task = _make_task(cls.shipment, state=TaskState.DONE)

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.user)

    def _get_item(self, cargo_code: str) -> dict:
        resp = self.client.get(BOARD_URL)
        self.assertEqual(resp.status_code, 200)
        for items in resp.json()['columns'].values():
            for item in items:
                if item['cargo_code'] == cargo_code:
                    return item
        self.fail(f"{cargo_code} not found in board response")

    def test_item_has_required_fields(self) -> None:
        item = self._get_item('BRDF001')
        required = [
            'id', 'cargo_code', 'phase', 'owner_role',
            'time_in_phase_seconds', 'tasks_done', 'tasks_total',
            'late_count', 'in_progress_count', 'blocked_count',
        ]
        for field in required:
            self.assertIn(field, item, f"Missing field: {field}")

    def test_tasks_total_correct(self) -> None:
        item = self._get_item('BRDF001')
        self.assertEqual(item['tasks_total'], 2)

    def test_tasks_done_correct(self) -> None:
        item = self._get_item('BRDF001')
        self.assertEqual(item['tasks_done'], 1)

    def test_late_count_correct(self) -> None:
        item = self._get_item('BRDF001')
        self.assertEqual(item['late_count'], 1)

    def test_phase_is_load_for_yuklenme(self) -> None:
        item = self._get_item('BRDF001')
        self.assertEqual(item['phase'], 'LOAD')

    def test_time_in_phase_seconds_is_non_negative_int_or_null(self) -> None:
        item = self._get_item('BRDF001')
        val = item['time_in_phase_seconds']
        if val is not None:
            self.assertIsInstance(val, int)
            self.assertGreaterEqual(val, 0)

    def test_in_progress_count_zero_when_no_active_tasks(self) -> None:
        item = self._get_item('BRDF001')
        # We only have OPEN and DONE tasks — no IN_PROGRESS.
        self.assertEqual(item['in_progress_count'], 0)

    def test_blocked_count_zero_when_no_blocked_tasks(self) -> None:
        item = self._get_item('BRDF001')
        self.assertEqual(item['blocked_count'], 0)


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

class BoardFilterTests(TestCase):
    """Query-param filters narrow the columns correctly."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('brd_filter_user')
        cls.season = _make_season('brd-flt')  # <= 10 chars
        # Use unique codes to avoid conflicts with other test classes.
        cls.country_a = _make_country('CountryAlpha', 'CTA')
        cls.country_b = _make_country('CountryBeta', 'CTB')
        cls.cust_x = _make_customer('BrdCustX')
        cls.cust_y = _make_customer('BrdCustY')

        cls.ship_a = _make_shipment(
            'BRD_FA1', 'yuklenme', season=cls.season,
            country=cls.country_a, customer=cls.cust_x, is_gapy_satys=False,
        )
        cls.ship_b = _make_shipment(
            'BRD_FB1', 'yuklenme', season=cls.season,
            country=cls.country_b, customer=cls.cust_y, is_gapy_satys=True,
        )

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.user)

    def _all_codes(self, resp) -> set[str]:
        return {
            item['cargo_code']
            for items in resp.json()['columns'].values()
            for item in items
        }

    def test_filter_by_country_includes_matching(self) -> None:
        resp = self.client.get(BOARD_URL, {'country': self.country_a.pk})
        self.assertEqual(resp.status_code, 200)
        codes = self._all_codes(resp)
        self.assertIn('BRD_FA1', codes)
        self.assertNotIn('BRD_FB1', codes)

    def test_filter_by_country_excludes_other(self) -> None:
        resp = self.client.get(BOARD_URL, {'country': self.country_b.pk})
        codes = self._all_codes(resp)
        self.assertIn('BRD_FB1', codes)
        self.assertNotIn('BRD_FA1', codes)

    def test_filter_by_customer(self) -> None:
        resp = self.client.get(BOARD_URL, {'customer': self.cust_x.pk})
        codes = self._all_codes(resp)
        self.assertIn('BRD_FA1', codes)
        self.assertNotIn('BRD_FB1', codes)

    def test_filter_gapy_satys_true(self) -> None:
        resp = self.client.get(BOARD_URL, {'gapy_satys': 'true'})
        codes = self._all_codes(resp)
        self.assertIn('BRD_FB1', codes)
        self.assertNotIn('BRD_FA1', codes)

    def test_filter_gapy_satys_false(self) -> None:
        resp = self.client.get(BOARD_URL, {'gapy_satys': 'false'})
        codes = self._all_codes(resp)
        self.assertIn('BRD_FA1', codes)
        self.assertNotIn('BRD_FB1', codes)

    def test_search_by_cargo_code_partial(self) -> None:
        resp = self.client.get(BOARD_URL, {'search': 'BRD_FA'})
        codes = self._all_codes(resp)
        self.assertIn('BRD_FA1', codes)
        self.assertNotIn('BRD_FB1', codes)

    def test_search_returns_empty_for_nomatch(self) -> None:
        resp = self.client.get(BOARD_URL, {'search': 'ZZZNOMATCH'})
        codes = self._all_codes(resp)
        self.assertEqual(codes, set())

    def test_filter_owner_role_matches_latest_task(self) -> None:
        """owner_role filter: only shipments whose latest task has that role."""
        _make_task(self.ship_a, assignee_role='document_team')
        resp = self.client.get(BOARD_URL, {'owner_role': 'document_team'})
        codes = self._all_codes(resp)
        self.assertIn('BRD_FA1', codes)
        # ship_b has no tasks — should be excluded by the owner_role filter.
        self.assertNotIn('BRD_FB1', codes)


# ---------------------------------------------------------------------------
# Sort order within column
# ---------------------------------------------------------------------------

class BoardColumnSortTests(TestCase):
    """Late shipments appear before active, which appear before idle."""

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('brd_sort_user')
        cls.season = _make_season('brd-srt')  # <= 10 chars

        # Three shipments all in LOAD (yuklenme) so they land in the same column.
        cls.ship_idle   = _make_shipment('BRDS_IDLE',   'yuklenme', season=cls.season)
        cls.ship_active = _make_shipment('BRDS_ACT',    'yuklenme', season=cls.season)
        cls.ship_late   = _make_shipment('BRDS_LATE',   'yuklenme', season=cls.season)

        # late: past-deadline open task
        _make_task(
            cls.ship_late, state=TaskState.OPEN,
            deadline=timezone.now() - datetime.timedelta(hours=1),
        )
        # active: in-progress task, no overdue deadline
        _make_task(cls.ship_active, state=TaskState.IN_PROGRESS)
        # idle: no tasks

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.user)

    def test_late_before_active_before_idle(self) -> None:
        resp = self.client.get(BOARD_URL)
        self.assertEqual(resp.status_code, 200)
        load_items = resp.json()['columns']['LOAD']
        codes = [i['cargo_code'] for i in load_items]

        self.assertIn('BRDS_LATE', codes)
        self.assertIn('BRDS_ACT', codes)
        self.assertIn('BRDS_IDLE', codes)

        late_idx   = codes.index('BRDS_LATE')
        active_idx = codes.index('BRDS_ACT')
        idle_idx   = codes.index('BRDS_IDLE')

        self.assertLess(late_idx, active_idx, "Late should appear before active")
        self.assertLess(active_idx, idle_idx, "Active should appear before idle")


# ---------------------------------------------------------------------------
# Query count constraint
# ---------------------------------------------------------------------------

class BoardQueryCountTests(TestCase):
    """The board endpoint is bounded at <= 8 queries for any result set size.

    Note: the plan (§D3) mentions assertNumQueries <= 5 as a target. The
    task instructions specify <= 8 as the binding constraint; we use 8 here.
    """

    QUERY_LIMIT = 8

    @classmethod
    def setUpTestData(cls):
        call_command('seed_permissions')
        cls.user = _make_user('brd_qcount_user')
        cls.season = _make_season('brd-qcnt')  # <= 10 chars
        status = _make_status('yuklenme', step_order=1)

        # MSSQL: bulk_create doesn't return PKs. Create shipments, then fetch
        # them back by cargo_code to get the PKs for task FK assignment.
        Shipment.objects.bulk_create(
            [
                Shipment(
                    cargo_code=f'BRDQ{i:04d}',
                    date='2026-01-15',
                    season=cls.season,
                    status=status,
                )
                for i in range(100)
            ],
            batch_size=500,
        )
        # Re-fetch with PKs so tasks can reference them.
        shipments = list(
            Shipment.objects.filter(cargo_code__startswith='BRDQ').only('pk')
        )
        Task.objects.bulk_create(
            [
                Task(
                    shipment=s,
                    step='yuklenme',
                    title_key='tasks.test',
                    assignee_role='warehouse_chief',
                    completion_rule=TaskCompletionRule.MANUAL_DONE,
                    state=TaskState.OPEN,
                )
                for s in shipments
            ],
            batch_size=500,
        )

    def setUp(self) -> None:
        self.client = APIClient()
        _auth(self.client, self.user)

    def test_query_count_bounded(self) -> None:
        from django.test.utils import CaptureQueriesContext
        from django.db import connection

        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get(BOARD_URL)

        actual_count = len(ctx.captured_queries)
        self.assertEqual(
            resp.status_code,
            200,
            f"Expected 200, got {resp.status_code}",
        )
        self.assertLessEqual(
            actual_count,
            self.QUERY_LIMIT,
            f"Board endpoint used {actual_count} queries at 100 shipments "
            f"(limit is {self.QUERY_LIMIT}). "
            f"Queries:\n"
            + "\n".join(q['sql'][:200] for q in ctx.captured_queries),
        )
