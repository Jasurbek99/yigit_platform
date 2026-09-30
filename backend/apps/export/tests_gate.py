"""Gate guard: lists and actions (services/gate.py).

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §1.2–1.3
"""
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Customer, Season, TomatoVariety
from apps.export.models import AuditLog, Notification, ShipmentBlockSource, Task, TaskState
from apps.export.services import gate
from apps.export.tests_gate_fixtures import GateFixtures


class GateListTests(GateFixtures, TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.make_gate_world()

    def _ids(self, qs):
        return set(qs.values_list('pk', flat=True))

    def test_truck_with_a_block_at_the_location_is_expected(self):
        truck = self.make_truck('G-1')
        self.assertIn(truck.pk, self._ids(gate.expected(self.dusak)))
        self.assertNotIn(truck.pk, self._ids(gate.expected(self.kaka)))

    def test_loading_location_wins_over_the_blocks(self):
        truck = self.make_truck('G-2', block=self.block_k, loading_location=self.dusak)
        self.assertIn(truck.pk, self._ids(gate.expected(self.dusak)))
        self.assertNotIn(truck.pk, self._ids(gate.expected(self.kaka)))

    def test_plate_is_required(self):
        blank = self.make_truck('G-3', plate='')
        none = self.make_truck('G-4', plate=None)
        ids = self._ids(gate.expected(self.dusak))
        self.assertNotIn(blank.pk, ids)
        self.assertNotIn(none.pk, ids)

    def test_packing_part_is_not_listed_until_it_has_a_destination(self):
        part = self.make_truck('G-P1', status='draft')
        self.assertNotIn(part.pk, self._ids(gate.expected(self.dusak)))
        part.customer = Customer.objects.create(name='Gate buyer')
        part.save()
        self.assertIn(part.pk, self._ids(gate.expected(self.dusak)))

    def test_only_statuses_before_departure(self):
        buyer = Customer.objects.create(name='Gate buyer 2')
        listed = [
            self.make_truck(f'G-S{i}', status=s, customer=buyer)
            for i, s in enumerate(gate.PRE_DEPARTURE)
        ]
        gone = self.make_truck('G-S9', status='yola_chykdy')
        ids = self._ids(gate.expected(self.dusak))
        self.assertTrue(all(t.pk in ids for t in listed))
        self.assertNotIn(gone.pk, ids)

    def test_cancelled_deleted_and_archived_are_excluded(self):
        cancelled = self.make_truck('G-5', status='cancelled')
        deleted = self.make_truck('G-6', deleted_at=timezone.now())
        archived = self.make_truck('G-7', is_archived=True)
        ids = self._ids(gate.expected(self.dusak))
        self.assertFalse({cancelled.pk, deleted.pk, archived.pk} & ids)

    def test_date_window_edges(self):
        # 30 days back: a truck whose documents/customs took two weeks is still
        # coming (1709001/26, 13 days old, was hidden by the first 7-day rule).
        in_back = self.make_truck('G-W1', days=-30)
        out_back = self.make_truck('G-W2', days=-31)
        in_ahead = self.make_truck('G-W3', days=1)
        out_ahead = self.make_truck('G-W4', days=2)
        ids = self._ids(gate.expected(self.dusak))
        self.assertTrue({in_back.pk, in_ahead.pk} <= ids)
        self.assertFalse({out_back.pk, out_ahead.pk} & ids)

    def test_arrived_truck_moves_from_expected_to_inside(self):
        truck = self.make_truck('G-8', greenhouse_arrived_at=timezone.now())
        self.assertNotIn(truck.pk, self._ids(gate.expected(self.dusak)))
        self.assertIn(truck.pk, self._ids(gate.inside(self.dusak)))

    def test_inside_ignores_status(self):
        truck = self.make_truck('G-9', status='yola_chykdy', greenhouse_arrived_at=timezone.now())
        self.assertIn(truck.pk, self._ids(gate.inside(self.dusak)))

    def test_recently_left_holds_ten_minutes(self):
        now = timezone.now()
        fresh = self.make_truck('G-10', greenhouse_arrived_at=now - timedelta(hours=1),
                                departed_at=now - timedelta(minutes=9))
        stale = self.make_truck('G-11', greenhouse_arrived_at=now - timedelta(hours=1),
                                departed_at=now - timedelta(minutes=11))
        ids = self._ids(gate.recently_left(self.dusak, now))
        self.assertIn(fresh.pk, ids)
        self.assertNotIn(stale.pk, ids)

    def test_timestamps_are_local_not_utc(self):
        truck = self.make_truck('G-14', greenhouse_arrived_at=timezone.now())
        row = gate.gate_row(truck)
        self.assertTrue(row['greenhouse_arrived_at'].endswith('+05:00'))

    def test_row_carries_only_gate_fields(self):
        truck = self.make_truck('G-12', driver_name='Aman', driver_phone='+99365000000')
        row = gate.gate_row(truck)
        self.assertEqual(set(row), {
            'id', 'shipment_code', 'truck_plate', 'truck_plate_2', 'driver_name', 'driver_phone',
            'date', 'is_gapy_satys', 'status_code', 'greenhouse_arrived_at', 'departed_at',
            'can_undo',
        })
        self.assertEqual(row['status_code'], 'gumruk_chykysh')
        self.assertFalse(row['can_undo'])

    def test_can_undo_rules(self):
        now = timezone.now()
        mark = now - timedelta(minutes=5)
        truck = self.make_truck('G-13', greenhouse_arrived_at=mark)
        truck.status_changed_at = mark - timedelta(hours=1)
        self.assertTrue(gate.can_undo(truck, 'arrive', now))
        self.assertFalse(gate.can_undo(truck, 'arrive', mark + timedelta(minutes=11)))
        truck.status_changed_at = mark + timedelta(seconds=1)
        self.assertFalse(gate.can_undo(truck, 'arrive', now))
        truck.status_changed_at = None
        truck.departed_at = now
        self.assertFalse(gate.can_undo(truck, 'arrive', now))
        self.assertTrue(gate.can_undo(truck, 'depart', now))


class GateActionTests(GateFixtures, TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.make_gate_world()
        cls.variety = TomatoVariety.objects.create(name='Gate Pink')

    def test_arrive_stamps_time_location_and_loading_start(self):
        truck = self.make_truck('A-1', status='gumruk_girish')
        result = gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertIsNotNone(result.greenhouse_arrived_at)
        self.assertEqual(result.loading_location, self.dusak)
        self.assertEqual(result.loading_started_at, result.greenhouse_arrived_at)
        self.assertEqual(result.status.code, 'gumruk_girish')  # docs not done: nothing moves yet

    def test_arrive_keeps_an_existing_loading_start(self):
        earlier = timezone.now() - timedelta(hours=2)
        truck = self.make_truck('A-2', status='gumruk_girish', loading_started_at=earlier)
        result = gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertEqual(result.loading_started_at, earlier)

    def test_arrive_from_customs_exit_starts_loading(self):
        truck = self.make_truck('A-3', status='gumruk_chykysh')
        result = gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertEqual(result.status.code, 'yuklenme')

    def test_arrive_notifies_head_and_active_deputies_only(self):
        truck = self.make_truck('A-4')
        gate.arrive(truck.pk, self.dusak, self.guard)
        notified = set(
            Notification.objects.filter(kind='gate_arrival').values_list('user_id', flat=True)
        )
        self.assertEqual(notified, {self.head.pk, self.deputy.pk})
        message = Notification.objects.filter(kind='gate_arrival').first().message
        self.assertIn('1535AKM', message)
        self.assertIn('Dusak', message)

    def test_second_arrive_is_refused_and_notifies_once(self):
        truck = self.make_truck('A-5')
        gate.arrive(truck.pk, self.dusak, self.guard)
        with self.assertRaises(gate.GateError) as ctx:
            gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertEqual(ctx.exception.code, 'not_expected')
        self.assertEqual(Notification.objects.filter(kind='gate_arrival').count(), 2)

    def test_other_locations_truck_is_refused(self):
        truck = self.make_truck('A-6')
        with self.assertRaises(gate.GateError) as ctx:
            gate.arrive(truck.pk, self.kaka, self.guard_kaka)
        self.assertEqual(ctx.exception.code, 'not_expected')

    def test_arrive_is_audited_as_the_guard(self):
        truck = self.make_truck('A-7')
        gate.arrive(truck.pk, self.dusak, self.guard)
        fields = set(
            AuditLog.objects.filter(object_id=truck.pk, user=self.guard)
            .values_list('field_name', flat=True)
        )
        self.assertTrue({'greenhouse_arrived_at', 'loading_location', 'loading_started_at'} <= fields)

    def test_closed_season_is_refused_and_writes_nothing(self):
        closed = Season.objects.create(
            name='2024-2025', start_date='2024-09-01', end_date='2025-06-30',
            is_active=False, closed_at=timezone.now(),
        )
        truck = self.make_truck('A-8', season=closed)
        with self.assertRaises(gate.GateError) as ctx:
            gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertEqual(ctx.exception.code, 'season_closed')
        truck.refresh_from_db()
        self.assertIsNone(truck.greenhouse_arrived_at)
        self.assertFalse(Notification.objects.filter(kind='gate_arrival').exists())

    def _loaded_truck(self, code, **extra):
        truck = self.make_truck(code, status='yuklenme', variety=self.variety,
                                weight_net=Decimal('18000'), **extra)
        truck.save()  # resolve fill_loading_data now that its fields are set
        return gate.arrive(truck.pk, self.dusak, self.guard)

    def test_arrive_without_packing_stamps_but_does_not_start_loading(self):
        """A truck whose packing has not been joined yet still gets its
        arrival stamped and its notification sent, but loading_started_at
        must stay null — there is nothing to load (final-fix review F5)."""
        truck = self.make_truck('A-9', status='gumruk_chykysh', loading_location=self.dusak)
        ShipmentBlockSource.objects.filter(shipment=truck).delete()
        result = gate.arrive(truck.pk, self.dusak, self.guard)
        self.assertIsNotNone(result.greenhouse_arrived_at)
        self.assertIsNone(result.loading_started_at)
        self.assertEqual(result.status.code, 'gumruk_chykysh')
        self.assertTrue(Notification.objects.filter(kind='gate_arrival').exists())

    def test_depart_moves_a_loaded_truck_to_the_road(self):
        truck = self._loaded_truck('D-1')
        result = gate.depart(truck.pk, self.dusak, self.guard)
        self.assertIsNotNone(result.departed_at)
        self.assertEqual(result.status.code, 'yola_chykdy')

    def test_depart_completes_a_gapy_truck(self):
        truck = self._loaded_truck('D-2', is_gapy_satys=True)
        result = gate.depart(truck.pk, self.dusak, self.guard)
        self.assertEqual(result.status.code, 'tamamlandy')

    def test_depart_without_loading_data_keeps_the_status(self):
        truck = self.make_truck('D-3', status='yuklenme')
        gate.arrive(truck.pk, self.dusak, self.guard)
        result = gate.depart(truck.pk, self.dusak, self.guard)
        self.assertEqual(result.status.code, 'yuklenme')

    def test_depart_needs_an_arrival(self):
        truck = self.make_truck('D-4')
        with self.assertRaises(gate.GateError) as ctx:
            gate.depart(truck.pk, self.dusak, self.guard)
        self.assertEqual(ctx.exception.code, 'not_inside')

    def test_undo_arrive_clears_what_the_guard_wrote(self):
        truck = self.make_truck('U-1', status='gumruk_girish')
        gate.arrive(truck.pk, self.dusak, self.guard)
        result = gate.undo(truck.pk, self.dusak, self.guard, 'arrive')
        self.assertIsNone(result.greenhouse_arrived_at)
        self.assertIsNone(result.loading_started_at)

    def test_undo_arrive_keeps_a_loading_start_it_did_not_write(self):
        earlier = timezone.now() - timedelta(hours=2)
        truck = self.make_truck('U-2', status='gumruk_girish', loading_started_at=earlier)
        gate.arrive(truck.pk, self.dusak, self.guard)
        result = gate.undo(truck.pk, self.dusak, self.guard, 'arrive')
        self.assertEqual(result.loading_started_at, earlier)

    def test_undo_after_a_status_move_is_refused(self):
        truck = self.make_truck('U-3', status='gumruk_chykysh')
        gate.arrive(truck.pk, self.dusak, self.guard)  # → yuklenme
        with self.assertRaises(gate.GateError) as ctx:
            gate.undo(truck.pk, self.dusak, self.guard, 'arrive')
        self.assertEqual(ctx.exception.code, 'undo_closed')

    def test_undo_depart_reopens_the_departure_trigger(self):
        truck = self.make_truck('U-4', status='yuklenme')
        gate.arrive(truck.pk, self.dusak, self.guard)
        gate.depart(truck.pk, self.dusak, self.guard)  # loading data missing: stays yuklenme
        trigger = Task.objects.get(shipment=truck, title_key='tasks.trigger_departure')
        self.assertEqual(trigger.state, TaskState.DONE)
        result = gate.undo(truck.pk, self.dusak, self.guard, 'depart')
        self.assertIsNone(result.departed_at)
        trigger.refresh_from_db()
        self.assertEqual(trigger.state, TaskState.OPEN)

    def test_undo_rejects_an_unknown_event(self):
        truck = self.make_truck('U-5')
        with self.assertRaises(gate.GateError) as ctx:
            gate.undo(truck.pk, self.dusak, self.guard, 'x')
        self.assertEqual(ctx.exception.code, 'bad_event')
