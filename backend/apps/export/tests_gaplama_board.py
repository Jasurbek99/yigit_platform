"""build_gaplama_board() — the FIFO carry-over calculation.

Covers the 9 scenarios from the Gaplama Screen plan's Task 2 brief, a query-count
regression test, and three review-driven additions: a FIFO-order test that survives
expiry (totals alone can't distinguish FIFO from LIFO), a two-block isolation test
(buckets must not bleed between blocks), and a sub-block grain-folding test (a
ShipmentBlockSource row pointing at a sub-block must still count toward its parent's
loaded_kg and be reported at parent grain in trucks[]).

Season/ShipmentStatusType/GreenhouseBlock fixtures follow the pattern already used in
tests_draft_promote.py (direct ORM creation, ShipmentStatusType seeded inline per test
class since DJANGO_TESTING=true skips the seeding migrations).

Flat `tests_*.py` naming (not a `tests/` package) — this app's convention everywhere
else (tests_draft_promote.py, tests_truck_allocation_tasks.py, ...). A `tests/` package
with an `__init__.py` would shadow the existing `apps/export/tests.py` module (Python
resolves the package over the same-named module), breaking `manage.py test apps.export`
discovery for ~49 pre-existing test classes.

Run:
    python manage.py test apps.export.tests_gaplama_board --keepdb
"""
from datetime import date
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import (
    GreenhouseBlock,
    GreenhouseConfig,
    LoadingLocation,
    RolePagePermission,
    Season,
    ShipmentStatusType,
    User,
)
from apps.export.models import Shipment, ShipmentBlockSource
from apps.export.services.gaplama import build_gaplama_board
from apps.greenhouse.models import HarvestDayEntry, WeeklyHarvestPlan


def _make_status(code: str, step_order: int, name_en: str) -> ShipmentStatusType:
    obj, _ = ShipmentStatusType.objects.get_or_create(
        code=code,
        defaults={
            'name_tk': code, 'name_en': name_en, 'name_ru': name_en,
            'step_order': step_order, 'phase': 'PREP',
        },
    )
    return obj


class GaplamaBoardTest(TestCase):
    def setUp(self):
        self.season = Season.objects.create(
            name='2026/27', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        self.location = LoadingLocation.objects.create(name='Dusak')
        self.block = GreenhouseBlock.objects.create(
            code='F', name='F-Ýyladyşhana', location=self.location, is_active=True,
        )
        self.draft_status = _make_status('draft', 0, 'Draft')
        _make_status('cancelled', 99, 'Cancelled')
        GreenhouseConfig.objects.all().delete()
        self.config = GreenhouseConfig.get_solo()
        self.config.gaplama_carry_days = 2
        self.config.save()

    def _plan(self, entry_date, kg, block=None):
        block = block or self.block
        iso_year, iso_week, _ = entry_date.isocalendar()
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=block, week_number=iso_week, year=iso_year,
        )
        HarvestDayEntry.objects.create(
            weekly_plan=plan, season=self.season, block=block,
            entry_date=entry_date, weekday=entry_date.weekday(),
            plan_value=Decimal(kg),
        )

    def _truck(self, ship_date, kg, status_code='draft', block=None):
        block = block or self.block
        status = ShipmentStatusType.objects.get(code=status_code)
        shipment = Shipment.objects.create(
            shipment_code=f'T{ship_date.strftime("%m%d")}-{Shipment.objects.count()}',
            date=ship_date, season=self.season, status=status,
        )
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=block, weight_kg=Decimal(kg),
        )
        return shipment

    def test_available_is_plan_minus_loaded(self):
        self._plan(date(2026, 9, 21), 20000)
        self._truck(date(2026, 9, 21), 12000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        row = board['days'][0]
        self.assertEqual(row['available_kg'], Decimal(8000))
        self.assertEqual(row['over_kg'], Decimal(0))

    def test_positive_remainder_carries_forward(self):
        self._plan(date(2026, 9, 21), 20000)   # Monday: 8000 will remain
        self._truck(date(2026, 9, 21), 12000)
        self._plan(date(2026, 9, 22), 5000)     # Tuesday
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 22), self.season)
        tuesday = next(r for r in board['days'] if r['date'] == date(2026, 9, 22))
        self.assertEqual(tuesday['carried_in_kg'], Decimal(8000))
        self.assertEqual(tuesday['available_kg'], Decimal(13000))  # 5000 + 8000

    def test_remainder_expires_after_carry_days(self):
        self._plan(date(2026, 9, 21), 20000)   # Monday: 20000 remains, carry_days=2
        # No truck at all this test — nothing consumed.
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 24), self.season)
        # Monday + 2 days = Wed is still live (lower bound); Thu is one day past
        # expiry (upper bound). Window includes the source day (09-21) so the plan
        # row is actually inside plan_map and expiry logic — not the lookback
        # cutoff — is what's under test.
        wednesday = next(r for r in board['days'] if r['date'] == date(2026, 9, 23))
        thursday = next(r for r in board['days'] if r['date'] == date(2026, 9, 24))
        self.assertEqual(wednesday['carried_in_kg'], Decimal(20000))
        self.assertEqual(thursday['carried_in_kg'], Decimal(0))

    def test_negative_never_carries(self):
        self._plan(date(2026, 9, 21), 10000)
        self._truck(date(2026, 9, 21), 15000)   # over-loaded by 5000
        self._plan(date(2026, 9, 22), 5000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 22), self.season)
        monday = next(r for r in board['days'] if r['date'] == date(2026, 9, 21))
        tuesday = next(r for r in board['days'] if r['date'] == date(2026, 9, 22))
        self.assertEqual(monday['available_kg'], Decimal(0))
        self.assertEqual(monday['over_kg'], Decimal(5000))
        self.assertEqual(tuesday['carried_in_kg'], Decimal(0))
        self.assertEqual(tuesday['available_kg'], Decimal(5000))

    def test_fifo_consumes_oldest_bucket_first(self):
        self._plan(date(2026, 9, 21), 10000)   # Monday: 10000 remains
        self._plan(date(2026, 9, 22), 10000)   # Tuesday: 10000 remains, +10000 carry-in = 20000 avail
        self._truck(date(2026, 9, 23), 15000)  # Wednesday: consumes Monday's bucket first
        self._plan(date(2026, 9, 23), 0)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 23), self.season)
        wednesday = next(r for r in board['days'] if r['date'] == date(2026, 9, 23))
        # Monday's 10000 (oldest) fully consumed, then 5000 from Tuesday's bucket.
        # Remaining carry-in reaching Wednesday's available: (10000 Mon + 10000 Tue) - 15000 = 5000.
        self.assertEqual(wednesday['available_kg'], Decimal(5000))

    def test_fifo_order_survives_expiry(self):
        # totals-only assertions (available_kg from a sum) can't distinguish FIFO from
        # LIFO or any other consumption order — only expiry timing can, because it
        # matters WHICH bucket got drained. carry_days=2.
        self._plan(date(2026, 9, 21), 10000)   # Monday bucket
        self._plan(date(2026, 9, 22), 10000)   # Tuesday bucket
        self._plan(date(2026, 9, 23), 0)
        self._truck(date(2026, 9, 23), 10000)  # Wednesday: drains exactly one bucket
        self._plan(date(2026, 9, 24), 0)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 24), self.season)
        thursday = next(r for r in board['days'] if r['date'] == date(2026, 9, 24))
        # FIFO drains Monday's bucket first, so Tuesday's 10000 is still live on
        # Thursday (Tue+2=Thu, still within carry_days). LIFO would have drained
        # Tuesday and left Monday, which expires by Thursday (Mon+2=Wed) -> 0.
        self.assertEqual(thursday['carried_in_kg'], Decimal(10000))

    def test_carry_over_does_not_bleed_between_blocks(self):
        # A plausible refactor (hoisting the FIFO bucket queue out of the per-block
        # loop) would silently share carry-over across blocks. Every other test in
        # this file uses only self.block, so it wouldn't catch that. Two distinct
        # top-level blocks here: A leaves a remainder, B must never see it.
        block_a = GreenhouseBlock.objects.create(
            code='A', name='A', location=self.location, is_active=True,
        )
        block_b = GreenhouseBlock.objects.create(
            code='B', name='B', location=self.location, is_active=True,
        )
        self._plan(date(2026, 9, 21), 10000, block=block_a)   # Monday: A leaves 10000
        self._plan(date(2026, 9, 22), 3000, block=block_b)    # Tuesday: B's own plan only
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 22), self.season)
        b_tuesday = next(
            r for r in board['days'] if r['block_id'] == block_b.id and r['date'] == date(2026, 9, 22)
        )
        self.assertEqual(b_tuesday['carried_in_kg'], Decimal(0))

    def test_cancelled_shipments_excluded(self):
        self._plan(date(2026, 9, 21), 20000)
        self._truck(date(2026, 9, 21), 12000, status_code='cancelled')
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        row = board['days'][0]
        self.assertEqual(row['loaded_kg'], Decimal(0))
        self.assertEqual(row['available_kg'], Decimal(20000))

    def test_null_kg_supply_rows_excluded(self):
        shipment = Shipment.objects.create(
            shipment_code='TESTNULL', date=date(2026, 9, 21), season=self.season,
            status=self.draft_status,
        )
        ShipmentBlockSource.objects.create(shipment=shipment, block=self.block, weight_kg=None)
        self._plan(date(2026, 9, 21), 20000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        row = board['days'][0]
        self.assertEqual(row['loaded_kg'], Decimal(0))

    def test_lookback_boundary_starts_with_zero_carry_in(self):
        # gaplama_carry_days=2. Plant a huge remainder 3 days before the window start,
        # i.e. outside even the lookback — it must not leak in as carry-in.
        self._plan(date(2026, 9, 17), 50000)   # Thursday, no truck — remains 50000
        self._plan(date(2026, 9, 21), 1000)    # Monday (window start)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        monday = board['days'][0]
        self.assertEqual(monday['carried_in_kg'], Decimal(0))

    def test_sub_blocks_excluded_from_days(self):
        # F1 is an active sub-block of F. It must not show up as its own permanent
        # all-zero board entry — days[] is top-level blocks only.
        GreenhouseBlock.objects.create(
            code='F1', name='F1', location=self.location, is_active=True, parent=self.block,
        )
        self._plan(date(2026, 9, 21), 20000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        block_ids = {row['block_id'] for row in board['days']}
        self.assertEqual(block_ids, {self.block.id})

    def test_inactive_top_level_block_excluded_from_days(self):
        # block_meta filters on b.is_active explicitly in Python now (the roster query
        # itself is unfiltered, to let code_by_id/parent_of resolve inactive blocks for
        # the sub-block fold below) — this pins that filter directly, since no other
        # test creates an inactive block at all.
        inactive = GreenhouseBlock.objects.create(
            code='Z', name='Z', location=self.location, is_active=False,
        )
        self._plan(date(2026, 9, 21), 20000, block=inactive)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        block_ids = {row['block_id'] for row in board['days']}
        self.assertNotIn(inactive.id, block_ids)

    def test_sub_block_loaded_folds_into_parent(self):
        # A ShipmentBlockSource row can point at a sub-block directly (13/151 rows
        # on the live dev DB do, despite write_block_sources() normally normalizing
        # to parent grain at write time — legacy/bypass data exists). If loaded_kg
        # only ever looked at top-level block ids, this kg would vanish from the
        # parent's loaded_kg (over-stating available_kg, under-stating over_kg) and
        # from trucks[].block_sources it would report the wrong block entirely.
        parent = GreenhouseBlock.objects.create(
            code='O', name='O', location=self.location, is_active=True,
        )
        sub = GreenhouseBlock.objects.create(
            code='O1', name='O1', location=self.location, is_active=True, parent=parent,
        )
        self._plan(date(2026, 9, 21), 20000, block=parent)
        shipment = self._truck(date(2026, 9, 21), 5000, block=sub)
        # Same truck ALSO has a row at parent grain directly (unique_together is
        # (shipment, block), so O and O1 can coexist on one shipment) — this must
        # merge with the sub-block row into a single block_sources entry, not two.
        ShipmentBlockSource.objects.create(shipment=shipment, block=parent, weight_kg=Decimal(3000))
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        row = next(r for r in board['days'] if r['block_id'] == parent.id)
        self.assertEqual(row['loaded_kg'], Decimal(8000))
        truck = next(t for t in board['trucks'] if t['id'] == shipment.id)
        self.assertEqual(len(truck['block_sources']), 1)
        self.assertEqual(truck['block_sources'][0]['block_id'], parent.id)
        self.assertEqual(truck['block_sources'][0]['block_code'], 'O')
        self.assertEqual(truck['block_sources'][0]['weight_kg'], Decimal(8000))

    def test_trucks_list_shape(self):
        self._plan(date(2026, 9, 21), 20000)
        shipment = self._truck(date(2026, 9, 21), 12000)
        board = build_gaplama_board(date(2026, 9, 21), date(2026, 9, 21), self.season)
        self.assertEqual(len(board['trucks']), 1)
        truck = board['trucks'][0]
        self.assertEqual(truck['id'], shipment.id)
        self.assertEqual(truck['block_sources'][0]['weight_kg'], Decimal(12000))
        self.assertIsNone(truck['country'])

    def test_query_count_flat_as_trucks_grow(self):
        # 1 config lookup (GreenhouseConfig.get_solo) + 1 active-block roster (now
        # unfiltered by parent, so sub-blocks ride along in the same single query) +
        # 1 plan aggregate + 1 loaded aggregate + 1 trucks list (flat values() JOIN,
        # not prefetch_related, so the per-shipment block_sources ride along in the
        # same query). The brief's comment said 3 (config + block roster uncounted);
        # adjusted to 5 to match reality — see task-2-report.md.
        self._plan(date(2026, 9, 21), 100000)
        with self.assertNumQueries(5):
            build_gaplama_board(date(2026, 9, 21), date(2026, 9, 27), self.season)
        for i in range(10):
            self._truck(date(2026, 9, 21), 1000)
        with self.assertNumQueries(5):
            build_gaplama_board(date(2026, 9, 21), date(2026, 9, 27), self.season)


class GaplamaBoardViewTest(TestCase):
    def setUp(self):
        cache.clear()
        self.season = Season.objects.create(
            name='2026/2027', start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            is_active=True,
        )
        self.location = LoadingLocation.objects.create(name='Dusak')
        self.block = GreenhouseBlock.objects.create(
            code='GB', name='GB-Ýyladyşhana', location=self.location, is_active=True,
        )
        _make_status('draft', 0, 'Draft')
        GreenhouseConfig.objects.all().delete()
        self.config = GreenhouseConfig.get_solo()
        self.config.gaplama_carry_days = 2
        self.config.save()
        self.client = APIClient()

    def _plan(self, entry_date, kg):
        iso_year, iso_week, _ = entry_date.isocalendar()
        plan, _ = WeeklyHarvestPlan.objects.get_or_create(
            season=self.season, block=self.block, week_number=iso_week, year=iso_year,
        )
        HarvestDayEntry.objects.create(
            weekly_plan=plan, season=self.season, block=self.block,
            entry_date=entry_date, weekday=entry_date.weekday(),
            plan_value=Decimal(kg),
        )

    def _truck(self, ship_date, kg):
        status = ShipmentStatusType.objects.get(code='draft')
        shipment = Shipment.objects.create(
            shipment_code=f'T{ship_date.strftime("%m%d")}-{Shipment.objects.count()}',
            date=ship_date, season=self.season, status=status,
        )
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=self.block, weight_kg=Decimal(kg),
        )
        return shipment

    def _user(self, role, tir_takip_gaplama=True, export_plan=True):
        user = User.objects.create_user(username=f'u_{role}', password='x', role=role)
        # NOTE: RolePagePermission's boolean field is `is_visible`, not `can_view`
        # (confirmed against apps/core/models/role_permissions.py and the working
        # pattern in tests_tir_hasabat.py's `_grant()` helper) — the brief's literal
        # snippet used `can_view`, which doesn't exist on the model.
        RolePagePermission.objects.update_or_create(
            role=role, page_code='tir_takip.gaplama', defaults={'is_visible': tir_takip_gaplama},
        )
        RolePagePermission.objects.update_or_create(
            role=role, page_code='export.plan', defaults={'is_visible': export_plan},
        )
        return user

    def test_requires_both_page_codes(self):
        user = self._user('loading_dept_head', tir_takip_gaplama=True, export_plan=False)
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-21', 'to_date': '2026-09-21',
        })
        self.assertEqual(resp.status_code, 403)

    def test_200_with_both_codes(self):
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-21', 'to_date': '2026-09-21',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertIn('days', resp.json())
        self.assertIn('trucks', resp.json())

    def test_inverted_dates_400(self):
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-22', 'to_date': '2026-09-21',
        })
        self.assertEqual(resp.status_code, 400)

    def test_over_31_days_400(self):
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-01', 'to_date': '2026-10-05',
        })
        self.assertEqual(resp.status_code, 400)

    def test_unknown_season_404(self):
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-21', 'to_date': '2026-09-21', 'season': 999999,
        })
        self.assertEqual(resp.status_code, 404)

    def test_missing_dates_400(self):
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/')
        self.assertEqual(resp.status_code, 400)

    def test_decimals_serialize_as_strings(self):
        # DRF's default JSONEncoder renders Decimal as a JSON number (float(obj)), not
        # a string — this pins the view's explicit str() coercion against that default,
        # per the endpoint's documented contract ("decimals as strings").
        self._plan(date(2026, 9, 21), 20000)
        self._truck(date(2026, 9, 21), 12000)
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-21', 'to_date': '2026-09-21',
        })
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        day = body['days'][0]
        for field in ('plan_kg', 'loaded_kg', 'carried_in_kg', 'available_kg', 'over_kg'):
            self.assertIsInstance(day[field], str)
        truck = body['trucks'][0]
        self.assertIsInstance(truck['block_sources'][0]['weight_kg'], str)
        self.assertEqual(Decimal(truck['block_sources'][0]['weight_kg']), Decimal(12000))

    def test_window_clamped_to_season_not_defaulted(self):
        # from_date sits before the season's start_date — the view must clamp the
        # walked window to the season boundary, not merely pass the raw dates through.
        self._plan(date(2026, 9, 1), 5000)
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-08-25', 'to_date': '2026-09-02',
        })
        self.assertEqual(resp.status_code, 200)
        days = resp.json()['days']
        self.assertTrue(days)
        earliest = min(date.fromisoformat(d['date']) for d in days)
        self.assertGreaterEqual(earliest, self.season.start_date)

    def test_close_open_gap_returns_empty_board(self):
        self.season.is_active = False
        self.season.save()
        user = self._user('loading_dept_head')
        self.client.force_authenticate(user)
        resp = self.client.get('/api/v1/export/gaplama/board/', {
            'from_date': '2026-09-21', 'to_date': '2026-09-21',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {'days': [], 'trucks': []})
