"""Gate tasks mirror the gate lists (services/gate_tasks.py).

Spec: docs/superpowers/specs/2026-09-29-garawul-gate-design.md §1.4
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Country, Customer
from apps.export.models import ShipmentBlockSource, Task, TaskKind, TaskState
from apps.export.services import gate
from apps.export.services.gate_tasks import STEP_ARRIVE, STEP_DEPART, sync_gate_tasks
from apps.export.tests_gate_fixtures import GateFixtures


class GateTaskSyncTests(GateFixtures, TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.make_gate_world()
        cls.country = Country.objects.create(name_tk='KZ', name_en='Kazakhstan', name_ru='KZ')
        cls.customer = Customer.objects.create(name='Berik')

    def _task(self, truck, step):
        return Task.objects.get(kind=TaskKind.GATE, shipment=truck, step=step)

    def test_expected_truck_gets_one_open_arrive_task(self):
        truck = self.make_truck('T-1')
        sync_gate_tasks(self.dusak)
        sync_gate_tasks(self.dusak)
        task = self._task(truck, STEP_ARRIVE)
        self.assertEqual(task.state, TaskState.OPEN)
        self.assertEqual(task.assignee_role, 'garawul')
        self.assertEqual(task.scope_location, self.dusak)
        self.assertIsNone(task.deadline)
        self.assertEqual(Task.objects.filter(kind=TaskKind.GATE, shipment=truck).count(), 1)

    def test_arrival_closes_the_arrive_task_for_the_guard_and_opens_exit(self):
        truck = self.make_truck('T-2')
        sync_gate_tasks(self.dusak)
        gate.arrive(truck.pk, self.dusak, self.guard)
        arrive_task = self._task(truck, STEP_ARRIVE)
        self.assertEqual((arrive_task.state, arrive_task.completed_by), (TaskState.DONE, self.guard))
        self.assertEqual(self._task(truck, STEP_DEPART).state, TaskState.OPEN)

    def test_exit_closes_the_exit_task(self):
        truck = self.make_truck('T-3')
        gate.arrive(truck.pk, self.dusak, self.guard)
        gate.depart(truck.pk, self.dusak, self.guard)
        exit_task = self._task(truck, STEP_DEPART)
        self.assertEqual((exit_task.state, exit_task.completed_by), (TaskState.DONE, self.guard))

    def test_undo_arrive_reopens_arrive_and_cancels_exit(self):
        truck = self.make_truck('T-4', status='gumruk_girish')
        gate.arrive(truck.pk, self.dusak, self.guard)
        gate.undo(truck.pk, self.dusak, self.guard, 'arrive')
        self.assertEqual(self._task(truck, STEP_ARRIVE).state, TaskState.OPEN)
        self.assertEqual(self._task(truck, STEP_DEPART).state, TaskState.CANCELLED)

    def test_deleted_truck_cancels_its_open_task(self):
        truck = self.make_truck('T-5')
        sync_gate_tasks(self.dusak)
        truck.deleted_at = timezone.now()
        truck.save()
        sync_gate_tasks(self.dusak)
        self.assertEqual(self._task(truck, STEP_ARRIVE).state, TaskState.CANCELLED)

    def test_task_follows_the_packaging_to_another_location(self):
        truck = self.make_truck('T-6')
        sync_gate_tasks(self.dusak)
        ShipmentBlockSource.objects.filter(shipment=truck).update(block=self.block_k)
        sync_gate_tasks(self.dusak)
        sync_gate_tasks(self.kaka)
        task = self._task(truck, STEP_ARRIVE)
        self.assertEqual((task.state, task.scope_location), (TaskState.OPEN, self.kaka))

    def test_assigning_a_truck_opens_the_arrive_task_without_a_gate_read(self):
        truck = self.make_truck('T-9', plate='', days=4)
        self.assertFalse(Task.objects.filter(kind=TaskKind.GATE, shipment=truck).exists())
        truck.truck_plate = '1535AKM'
        truck.save()
        self.assertEqual(self._task(truck, STEP_ARRIVE).state, TaskState.OPEN)

    def test_unassigning_the_truck_cancels_the_arrive_task(self):
        truck = self.make_truck('T-10')
        truck.save()
        truck.truck_plate = ''
        truck.save()
        self.assertEqual(self._task(truck, STEP_ARRIVE).state, TaskState.CANCELLED)

    def test_join_brings_the_gate_and_opens_the_arrive_task(self):
        from apps.export.views import ShipmentViewSet

        target = self.make_truck('T-11', status='draft', country=self.country, customer=self.customer)
        ShipmentBlockSource.objects.filter(shipment=target).delete()
        target.save()  # truck assigned, no packing yet: no gate to put it on
        self.assertFalse(Task.objects.filter(kind=TaskKind.GATE, shipment=target).exists())
        source = self.make_truck('T-12', status='draft', plate='')
        ShipmentViewSet._execute_join(target, source, self.head)
        self.assertEqual(self._task(target, STEP_ARRIVE).scope_location, self.dusak)

    def test_arrival_typed_on_the_sheet_also_opens_the_loading_start(self):
        # Documents back from customs (tasks.docs_from_customs, 2026-09-30).
        truck = self.make_truck('T-7', status='gumruk_chykysh', customs_exit_at=timezone.now())
        sync_gate_tasks(self.dusak)
        truck.greenhouse_arrived_at = timezone.now()
        truck.updated_by = self.head
        truck.save()  # no guard tap: the loading head corrects the Sheet
        self.assertEqual(self._task(truck, STEP_ARRIVE).state, TaskState.DONE)
        task = Task.objects.get(shipment=truck, title_key='tasks.trigger_loading_start')
        self.assertEqual(task.state, TaskState.OPEN)


class GateTaskCompleteRefusalTests(GateFixtures, TestCase):
    """POST /api/v1/export/tasks/{id}/complete/ must refuse a gate task — only
    the actual gate mark (arrive/depart) may close it (final-fix review F2)."""

    @classmethod
    def setUpTestData(cls):
        cls.make_gate_world()

    def test_complete_refuses_a_gate_task_and_leaves_it_open(self):
        truck = self.make_truck('T-8')
        sync_gate_tasks(self.dusak)
        task = Task.objects.get(kind=TaskKind.GATE, shipment=truck, step=STEP_ARRIVE)
        client = APIClient()
        client.force_authenticate(user=self.guard)
        resp = client.post(f'/api/v1/export/tasks/{task.pk}/complete/')
        self.assertEqual((resp.status_code, resp.data), (400, {'error': 'gate_task_needs_mark'}))
        task.refresh_from_db()
        self.assertEqual(task.state, TaskState.OPEN)


class GuardTaskBoardTests(GateFixtures, TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.make_gate_world()

    def test_guard_sees_only_his_locations_gate_tasks(self):
        mine = self.make_truck('B-1')
        theirs = self.make_truck('B-2', block=self.block_k)
        sync_gate_tasks(self.kaka)
        client = APIClient()
        client.force_authenticate(user=self.guard)
        resp = client.get('/api/v1/me/tasks/?page_size=100')
        self.assertEqual(resp.status_code, 200)
        rows = resp.data['results']
        shipments = {r['shipment'] for r in rows}
        self.assertIn(mine.pk, shipments)        # synced on read
        self.assertNotIn(theirs.pk, shipments)
        row = next(r for r in rows if r['shipment'] == mine.pk)
        self.assertEqual((row['kind'], row['truck_plate'], row['scope_location']),
                         ('gate', '1535AKM', self.dusak.pk))

    def test_guard_kpi_only_counts_his_own_locations_done_gate_tasks(self):
        from django.core.cache import cache

        mine = self.make_truck('KP-1')
        theirs = self.make_truck('KP-2', block=self.block_k)
        gate.arrive(mine.pk, self.dusak, self.guard)          # done at Dusak
        gate.arrive(theirs.pk, self.kaka, self.guard_kaka)    # done at Kaka
        cache.delete(f'me:kpi-today:{self.guard.id}:{self.guard.role}')
        client = APIClient()
        client.force_authenticate(user=self.guard)
        resp = client.get('/api/v1/me/kpi-today/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['done_count'], 1)
