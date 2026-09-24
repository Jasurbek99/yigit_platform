"""Gapy-Satyş ends at greenhouse departure.

A Gapy Satyş shipment is a domestic gate sale: the buyer takes the goods at
the greenhouse. No border, no destination customs, no arrival, no foreign
sales report. So `yuklenme` + `departed_at` completes it outright instead of
sending it to `yola_chykdy`, where it would jam forever — `border_crossed_at`
(R30) is gapy_hidden, so nobody can fill the trigger that leaves that step.

Run:
    python manage.py test apps.export.tests_gapy_terminal --keepdb
"""
import datetime

from django.test import TestCase
from django.utils import timezone

from apps.core.models import (
    GreenhouseBlock,
    Season,
    ShipmentStatusType,
    TomatoVariety,
    User,
)
from apps.export.management.commands.seed_task_rules import (
    Command as SeedTaskRulesCommand,
)
from apps.export.models import Shipment, ShipmentBlockSource, ShipmentStatusLog


V2_STATUSES = [
    ('draft',           0,  'DRAFT'),
    ('gumruk_girish',   1,  'CUSTOMS'),
    ('gumruk_chykysh',  2,  'CUSTOMS'),
    ('yuklenme',        3,  'LOADING'),
    ('yola_chykdy',     4,  'TRANSIT'),
    ('serhet_gechdi',   5,  'BORDER'),
    ('dest_entry',      6,  'BORDER'),
    ('barysh_gumrugi',  7,  'BORDER'),
    ('transshipment',   8,  'SALES'),
    ('bardy',           9,  'SALES'),
    ('satylyar',       10,  'SALES'),
    ('satyldy',        11,  'SALES'),
    ('tamamlandy',     12,  'COMPLETE'),
    ('cancelled',      99,  'CANCELLED'),
]


def _ensure_statuses():
    for code, order, phase in V2_STATUSES:
        ShipmentStatusType.objects.get_or_create(
            code=code,
            defaults={
                'name_tk': code, 'name_en': code, 'name_ru': code,
                'step_order': order, 'phase': phase,
            },
        )


def _make_season() -> Season:
    season, _ = Season.objects.get_or_create(
        name='2025-2026',
        defaults={
            'start_date': '2025-09-01',
            'end_date': '2026-06-30',
            'is_active': True,
        },
    )
    return season


class GapyTerminalTests(TestCase):
    """yuklenme + departed_at completes a gapy shipment, not a normal one."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        SeedTaskRulesCommand().handle(reset=False)
        cls.user = User.objects.create_user(
            username='gapy_doc', password='pw', role='document_team',
        )
        cls.season = _make_season()
        cls.block, _ = GreenhouseBlock.objects.get_or_create(code='A')
        cls.variety, _ = TomatoVariety.objects.get_or_create(name='Tomimaru')

    def _make_loaded(self, *, is_gapy: bool, code: str,
                     with_loading_data: bool = True) -> Shipment:
        """A shipment sitting in `yuklenme` with the loading gate satisfied.

        `fill_loading_data` requires shipment_code + block_sources + variety +
        weight_net (ALL_FIELDS_FILLED). With those present, filling
        departed_at is the only thing left, so the save triggers the advance.
        """
        status = ShipmentStatusType.objects.get(code='yuklenme')
        shipment = Shipment.objects.create(
            shipment_code=code,
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=status,
            is_gapy_satys=is_gapy,
            created_by=self.user,
            updated_by=self.user,
        )
        if with_loading_data:
            ShipmentBlockSource.objects.create(
                shipment=shipment, block=self.block, weight_kg=18000,
            )
            shipment.variety = self.variety
            shipment.weight_net = 18000
            shipment.save()
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, 'yuklenme')
        return shipment

    def test_gapy_completes_on_departure(self):
        shipment = self._make_loaded(is_gapy=True, code='GAPY-001/26')
        shipment.departed_at = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'tamamlandy')

    def test_non_gapy_still_departs(self):
        shipment = self._make_loaded(is_gapy=False, code='NORM-001/26')
        shipment.departed_at = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'yola_chykdy')

    def test_gapy_completion_is_one_audited_hop(self):
        """No intermediate statuses are walked, and the hop is flagged auto."""
        shipment = self._make_loaded(is_gapy=True, code='GAPY-002/26')
        shipment.departed_at = timezone.now()
        shipment.save()

        logs = list(
            ShipmentStatusLog.objects.filter(shipment=shipment)
            .order_by('changed_at')
        )
        self.assertEqual([lg.status.code for lg in logs], ['tamamlandy'])
        self.assertTrue(all(lg.is_auto for lg in logs))

    def test_gapy_does_not_cancel_on_departure(self):
        """Review Focus 1 — edge ordering.

        `_resolve_next_status` returns the first edge whose predicate is None.
        The `cancelled` edge carries no predicate, so if it is ordered before
        the two forked edges every gapy departure silently cancels the truck.
        """
        shipment = self._make_loaded(is_gapy=True, code='GAPY-003/26')
        shipment.departed_at = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        self.assertNotEqual(shipment.status.code, 'cancelled')

    def test_gapy_stays_when_loading_data_incomplete(self):
        """Review Focus 4 — the yuklenme gate still applies to gapy."""
        shipment = self._make_loaded(
            is_gapy=True, code='GAPY-004/26', with_loading_data=False,
        )
        shipment.departed_at = timezone.now()
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'yuklenme')

    def test_completed_gapy_stays_completed_on_resave(self):
        """Review Focus 5 — TRANSITIONS['tamamlandy'] is []."""
        shipment = self._make_loaded(is_gapy=True, code='GAPY-005/26')
        shipment.departed_at = timezone.now()
        shipment.save()
        shipment.refresh_from_db()

        shipment.additional_notes_arap = 'touched again'
        shipment.save()  # must not raise, must not move

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'tamamlandy')

    def test_late_flag_flip_does_not_retro_complete(self):
        """Review Focus 3 — flipping the flag mid-flight is accepted, unguarded.

        A shipment already past yuklenme keeps walking the export chain: the
        gapy predicate lives on the yuklenme edge only, and nothing rewrites
        history. This pins the documented decision, not a desirable behaviour.

        The flag is flipped **and the step's own trigger filled in the same
        save**, so auto-advance actually runs and _resolve_next_status is
        actually consulted. Flipping the flag alone resolves no task, so
        auto_advance_if_ready returns before reading any predicate — such a
        test would pass against an implementation that completes a gapy
        shipment from any status at all.
        """
        status = ShipmentStatusType.objects.get(code='serhet_gechdi')
        shipment = Shipment.objects.create(
            shipment_code='GAPY-LATE/26',
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=status,
            is_gapy_satys=False,
            created_by=self.user,
            updated_by=self.user,
        )
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, 'serhet_gechdi')

        shipment.is_gapy_satys = True
        shipment.dest_entry_at = timezone.now()  # serhet_gechdi's trigger
        shipment.save()

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'dest_entry')


class AllowedTransitionsPredicateTests(TestCase):
    """The UI is offered one branch of a fork, not both."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.user = User.objects.create_user(
            username='gapy_mgr', password='pw', role='export_manager',
        )
        cls.season = _make_season()

    def _at(self, code: str, **kwargs) -> Shipment:
        return Shipment.objects.create(
            shipment_code=f'ALT-{code[:6]}-{kwargs.get("suffix", "0")}',
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code=code),
            is_gapy_satys=kwargs.get('is_gapy_satys', False),
            has_peregruz=kwargs.get('has_peregruz', False),
            created_by=self.user,
            updated_by=self.user,
        )

    def _transitions(self, shipment: Shipment) -> list[str]:
        from apps.export.serializers import ShipmentDetailSerializer
        return ShipmentDetailSerializer(shipment).data['allowed_transitions']

    def test_gapy_at_loading_offers_only_completion(self):
        shipment = self._at('yuklenme', is_gapy_satys=True, suffix='g')
        self.assertEqual(self._transitions(shipment), ['tamamlandy'])

    def test_normal_at_loading_offers_only_departure(self):
        shipment = self._at('yuklenme', is_gapy_satys=False, suffix='n')
        self.assertEqual(self._transitions(shipment), ['yola_chykdy'])

    def test_peregruz_fork_offers_one_branch(self):
        """Pre-existing over-report, fixed by the same change."""
        with_p = self._at('barysh_gumrugi', has_peregruz=True, suffix='p')
        without_p = self._at('barysh_gumrugi', has_peregruz=False, suffix='q')
        self.assertEqual(self._transitions(with_p), ['transshipment'])
        self.assertEqual(self._transitions(without_p), ['bardy'])

    def test_completed_shipment_has_no_transitions(self):
        """TRANSITIONS['tamamlandy'] is an explicit []: no outgoing edge at
        all, not even cancelled."""
        shipment = self._at('tamamlandy', suffix='t')
        self.assertEqual(self._transitions(shipment), [])

    def test_manual_transition_is_still_permissive(self):
        """Review Focus 2 — transition_to() is deliberately NOT made
        predicate-aware. A privileged role may still drive either branch of a
        fork explicitly; only the offered list is narrowed. Tightening this
        would silently change has_peregruz semantics, so it is pinned.
        """
        from apps.export.services import transition_to
        shipment = self._at('barysh_gumrugi', has_peregruz=False, suffix='m')
        transition_to(shipment, 'transshipment', user=self.user)

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'transshipment')


class GapyHiddenRowTests(TestCase):
    """Rows describing events after departure are hidden in a gapy column."""

    # Everything after the truck leaves the greenhouse (R21). A gapy sale
    # happened at the gate, so there is no transshipment, no arrival and no
    # foreign sales report to record.
    EXPECTED_HIDDEN_AFTER_DEPARTURE = {
        'has_peregruz',
        'peregruz_date',
        'arrived_at',
        'sale_started_at',
        'sale_ended_at',
        'sales_report_date',
    }
    # Already hidden before this change — the road and destination rows.
    EXPECTED_HIDDEN_ALREADY = {
        'border_point',
        'border_crossed_at',
        'dest_entry_at',
        'customs_entry_at',
    }

    def test_post_departure_rows_are_gapy_hidden(self):
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        hidden = {
            row['field_key'] for row in DEFAULT_SHEET_ROWS
            if row.get('gapy_hidden')
        }
        self.assertEqual(
            hidden,
            self.EXPECTED_HIDDEN_AFTER_DEPARTURE | self.EXPECTED_HIDDEN_ALREADY,
        )

    def test_identity_rows_stay_visible_for_gapy(self):
        """city / country / customer are destination-block fields the draft
        join guard needs even for gapy (customer is 'ÝGT Gapy Satyş'), and
        they sit above departure. Deliberately NOT hidden."""
        from apps.export.sheet_rows import DEFAULT_SHEET_ROWS
        hidden = {
            row['field_key'] for row in DEFAULT_SHEET_ROWS
            if row.get('gapy_hidden')
        }
        for field in ('city', 'country', 'customer', 'departed_at', 'weight_net'):
            self.assertNotIn(field, hidden)


class TerminalStatusIsNotReachableByMistakeTests(TestCase):
    """The fork put a terminal status one step away from loading.

    `tamamlandy` has NO outgoing edges — not even `cancelled` (ADR-019 excludes
    it deliberately). So a shipment that lands there by mistake cannot be
    cancelled, cannot be transitioned back, and can only be soft-deleted and
    re-created. Before the fork, reaching `tamamlandy` took eleven steps and a
    filed sales report; now the edge sits on `yuklenme`, which is reachable
    from the Shipments page's bulk-transition modal. `transition_to()` stays
    permissive about predicates in general (a privileged role must be able to
    unstick a recoverable step), but not into a dead end.
    """

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        cls.manager = User.objects.create_user(
            username='gapy_term_mgr', password='pw', role='export_manager',
        )
        cls.season = _make_season()

    def _at_loading(self, *, is_gapy: bool, code: str) -> Shipment:
        return Shipment.objects.create(
            shipment_code=code,
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='yuklenme'),
            is_gapy_satys=is_gapy,
            created_by=self.manager,
            updated_by=self.manager,
        )

    def test_a_normal_truck_cannot_be_completed_from_loading(self):
        from apps.export.services import transition_to
        shipment = self._at_loading(is_gapy=False, code='TERM-001/26')

        with self.assertRaises(ValueError):
            transition_to(shipment, 'tamamlandy', user=self.manager)

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'yuklenme')

    def test_a_gapy_truck_cannot_be_sent_down_the_export_chain(self):
        """The mirror case: the branch a gapy shipment can never finish."""
        from apps.export.services import transition_to
        shipment = self._at_loading(is_gapy=True, code='TERM-002/26')

        with self.assertRaises(ValueError):
            transition_to(shipment, 'yola_chykdy', user=self.manager)

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'yuklenme')

    def test_the_matching_branch_is_still_allowed(self):
        from apps.export.services import transition_to
        gapy = self._at_loading(is_gapy=True, code='TERM-003/26')
        transition_to(gapy, 'tamamlandy', user=self.manager)
        gapy.refresh_from_db()
        self.assertEqual(gapy.status.code, 'tamamlandy')

        normal = self._at_loading(is_gapy=False, code='TERM-004/26')
        transition_to(normal, 'yola_chykdy', user=self.manager)
        normal.refresh_from_db()
        self.assertEqual(normal.status.code, 'yola_chykdy')

    def test_a_recoverable_fork_stays_permissive(self):
        """Regression guard on the narrowness of the fix.

        `barysh_gumrugi` forks on has_peregruz into two live intermediate
        steps. A wrong pick there is recoverable, and privileged roles rely on
        being able to make it, so predicates must NOT bind on that edge.
        """
        from apps.export.services import transition_to
        shipment = Shipment.objects.create(
            shipment_code='TERM-005/26',
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='barysh_gumrugi'),
            has_peregruz=False,
            created_by=self.manager,
            updated_by=self.manager,
        )
        transition_to(shipment, 'transshipment', user=self.manager)

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'transshipment')

    def test_cancel_still_works_from_loading(self):
        """The fix must not make the cancel edge unreachable — it carries no
        predicate and is not a dead end."""
        from apps.export.services import transition_to
        shipment = self._at_loading(is_gapy=True, code='TERM-006/26')
        transition_to(shipment, 'cancelled', user=self.manager)

        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'cancelled')


class GapyCompletionSideEffectTests(TestCase):
    """What a gapy completion must NOT trigger."""

    @classmethod
    def setUpTestData(cls):
        _ensure_statuses()
        SeedTaskRulesCommand().handle(reset=False)
        cls.user = User.objects.create_user(
            username='gapy_side_doc', password='pw', role='document_team',
        )
        cls.finansist = User.objects.create_user(
            username='gapy_side_fin', password='pw', role='finansist',
        )
        cls.season = _make_season()
        cls.block, _ = GreenhouseBlock.objects.get_or_create(code='A')
        cls.variety, _ = TomatoVariety.objects.get_or_create(name='Tomimaru')

    def _complete_gapy(self, code: str) -> Shipment:
        shipment = Shipment.objects.create(
            shipment_code=code,
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='yuklenme'),
            is_gapy_satys=True,
            created_by=self.user,
            updated_by=self.user,
        )
        ShipmentBlockSource.objects.create(
            shipment=shipment, block=self.block, weight_kg=18000,
        )
        shipment.variety = self.variety
        shipment.weight_net = 18000
        shipment.save()
        from apps.export.services.task_rules import generate_tasks_for_status
        generate_tasks_for_status(shipment, 'yuklenme')
        shipment.departed_at = timezone.now()
        shipment.save()
        shipment.refresh_from_db()
        return shipment

    def test_finansist_is_not_pinged_by_a_gate_sale(self):
        """STATUS_NOTIFY_ROLES['tamamlandy'] = ['finansist'] was written for the
        satyldy -> tamamlandy hand-off, where finance receives a sales report.
        A gate sale produces no report and leaves finance nothing to do, so the
        notification is pure noise on every gapy truck."""
        from apps.export.models import Notification
        shipment = self._complete_gapy('SIDE-001/26')
        self.assertEqual(shipment.status.code, 'tamamlandy')

        self.assertFalse(
            Notification.objects.filter(
                user=self.finansist,
                kind='action_required',
                link=f'/shipments/{shipment.id}',
            ).exists(),
        )

    def test_a_normal_completion_still_pings_finansist(self):
        from apps.export.models import Notification
        from apps.export.services import transition_to
        shipment = Shipment.objects.create(
            shipment_code='SIDE-002/26',
            date=datetime.date(2026, 1, 1),
            season=self.season,
            status=ShipmentStatusType.objects.get(code='satyldy'),
            is_gapy_satys=False,
            created_by=self.user,
            updated_by=self.user,
        )
        transition_to(shipment, 'tamamlandy', user=self.user)

        self.assertTrue(
            Notification.objects.filter(
                user=self.finansist,
                kind='action_required',
                link=f'/shipments/{shipment.id}',
            ).exists(),
        )


class GapyIsNotOwedASalesReportTests(TestCase):
    """`?needs_report=true` must not demand the impossible.

    The worklist lists everything from step 4 up with no SalesReport. A gapy
    truck now completes at step 12 without one, by design — the business says a
    gate sale has no sales report — so it would sit in the rep's and
    management's "still owed" queue forever, and the only way to clear it would
    be to file a report for a sale that produced none.
    """

    @classmethod
    def setUpTestData(cls):
        from django.core.management import call_command
        _ensure_statuses()
        call_command('seed_permissions', verbosity=0)
        cls.manager = User.objects.create_user(
            username='gapy_wl_mgr', password='pw', role='export_manager',
        )
        cls.season = _make_season()
        done = ShipmentStatusType.objects.get(code='tamamlandy')
        cls.gapy = Shipment.objects.create(
            shipment_code='WL-GAPY/26',
            date=datetime.date(2026, 1, 1),
            season=cls.season,
            status=done,
            is_gapy_satys=True,
            created_by=cls.manager,
            updated_by=cls.manager,
        )
        cls.normal = Shipment.objects.create(
            shipment_code='WL-NORM/26',
            date=datetime.date(2026, 1, 1),
            season=cls.season,
            status=ShipmentStatusType.objects.get(code='bardy'),
            is_gapy_satys=False,
            created_by=cls.manager,
            updated_by=cls.manager,
        )

    def setUp(self):
        from rest_framework.test import APIClient
        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)

    def _ids(self, url: str) -> list[int]:
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200, resp.content)
        results = resp.data['results'] if 'results' in resp.data else resp.data
        return [row['id'] for row in results]

    def test_gapy_is_not_listed_as_owing_a_report(self):
        ids = self._ids('/api/v1/export/shipments/my-sales-reports/?needs_report=true')
        self.assertNotIn(self.gapy.id, ids)

    def test_a_normal_truck_still_owes_one(self):
        ids = self._ids('/api/v1/export/shipments/my-sales-reports/?needs_report=true')
        self.assertIn(self.normal.id, ids)

    def test_gapy_is_still_visible_in_the_unfiltered_worklist(self):
        """Excluded from the demand, not hidden — management can still see the
        truck; there is simply nothing outstanding on it."""
        ids = self._ids('/api/v1/export/shipments/my-sales-reports/')
        self.assertIn(self.gapy.id, ids)
