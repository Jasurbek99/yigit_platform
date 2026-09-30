from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.core.models import Country, ShipmentStatusType
from apps.export.models import Notification, ShipmentComment
from apps.transport.models import ExternalTrip
from apps.transport.services.trip_assignment import AssignmentError, assign_trip, move_trip, unassign_trip
from apps.transport.services.trip_changes import accept_trip_change, apply_trip_change
from apps.transport.tests.test_trip_assignment import make_trip
from apps.transport.tests.test_trip_sync import _make_shipment

User = get_user_model()


class ApplyTripChangeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='em', password='x', role='export_manager')
        self.kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.shipment = _make_shipment(country=self.kz)
        self.trip = make_trip()
        assign_trip(self.trip, self.shipment, self.user)
        self.trip.refresh_from_db()

    def _swap_driver(self):
        self.trip.driver_full_name = 'Täze Sürüji'
        self.trip.save()

    def _set_status(self, code, **fields):
        status, _ = ShipmentStatusType.objects.get_or_create(code=code, defaults={'name_tk': code})
        type(self.shipment).objects.filter(pk=self.shipment.pk).update(status=status, **fields)
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()

    def test_draft_change_applies_and_comments(self):
        self._swap_driver()
        self.assertEqual(apply_trip_change(self.trip, self.user), 'applied')
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.driver_name, 'Täze Sürüji')
        comment = ShipmentComment.objects.filter(shipment=self.shipment, is_system=True).latest('id')
        self.assertIn('Amandurdyyew Atajan', comment.content)
        self.assertIn('Täze Sürüji', comment.content)
        self.assertTrue(Notification.objects.filter(user=self.user, link=f'/shipments/{self.shipment.pk}').exists())

    def test_departed_shipment_gets_conflict_not_change(self):
        self._set_status('yola_chykdy')
        self._swap_driver()
        self.assertEqual(apply_trip_change(self.trip, self.user), 'conflict')
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(self.shipment.driver_name, 'Amandurdyyew Atajan')
        self.assertIn('Täze Sürüji', self.trip.conflict_note)
        self.assertEqual(self.trip.conflict_kind, 'changed')
        self.assertEqual(self.trip.conflict_from, '2563AHF/2251TAH, Amandurdyyew Atajan')
        self.assertEqual(self.trip.conflict_to, '2563AHF/2251TAH, Täze Sürüji')

    def test_loading_started_is_a_conflict(self):
        self._set_status('yuklenme', loading_started_at=timezone.now())
        self._swap_driver()
        self.assertEqual(apply_trip_change(self.trip, self.user), 'conflict')

    def test_cancel_in_draft_unlinks(self):
        self.trip.status = 'CANCELLED'
        self.trip.save()
        self.assertEqual(apply_trip_change(self.trip, self.user), 'unlinked')
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertIsNone(self.shipment.trip_id)
        self.assertIsNone(self.trip.shipment_id)

    def test_cancel_when_locked_is_conflict_and_stays_linked(self):
        self._set_status('yola_chykdy')
        self.trip.status = 'CANCELLED'
        self.trip.save()
        self.assertEqual(apply_trip_change(self.trip, self.user), 'conflict')
        self.trip.refresh_from_db()
        self.assertEqual(self.trip.shipment_id, self.shipment.pk)
        self.assertEqual(self.trip.conflict_kind, 'cancelled')

    def test_accept_applies_despite_lock_and_clears_conflict(self):
        self._set_status('yola_chykdy')
        self._swap_driver()
        apply_trip_change(self.trip, self.user)
        self.trip.refresh_from_db()
        accept_trip_change(self.trip, self.user)
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(self.shipment.driver_name, 'Täze Sürüji')
        self.assertIsNone(self.trip.conflict_note)
        self.assertEqual(self.shipment.status.code, 'yola_chykdy')

    def test_move_refused_when_source_locked(self):
        self._set_status('yola_chykdy')
        other = _make_shipment(code='T-2', country=self.kz)
        with self.assertRaises(AssignmentError) as ctx:
            move_trip(self.trip, other, self.user)
        self.assertEqual(ctx.exception.code, 'locked')

    def test_move_between_drafts(self):
        other = _make_shipment(code='T-2', country=self.kz)
        move_trip(self.trip, other, self.user)
        self.shipment.refresh_from_db()
        other.refresh_from_db()
        self.assertIsNone(self.shipment.trip_id)
        self.assertEqual(other.trip_id, self.trip.pk)

    def test_unassign_in_draft_clears_trip(self):
        unassign_trip(self.trip, self.user)
        self.shipment.refresh_from_db()
        self.assertIsNone(self.shipment.trip_id)


    def test_cancelled_shipment_frees_its_trip(self):
        from apps.transport.services.trip_assignment import release_cancelled_shipments
        self._set_status('cancelled')
        self.assertEqual(release_cancelled_shipments(), 1)
        self.trip.refresh_from_db()
        self.shipment.refresh_from_db()
        self.assertIsNone(self.trip.shipment_id)
        self.assertIsNone(self.shipment.trip_id)


@override_settings(TRANSPORT_API_MODE='mock')
class RollbackPathTests(TestCase):
    """Customs-status change → rollback to draft. Reuses the full builder from
    apps.export.tests_rollback (RollbackTests._make_advanced_shipment)."""

    def test_customs_change_rolls_back(self):
        from apps.export.tests_auto_advance import _ensure_statuses, _make_user, _seed_rules
        from apps.export.tests_rollback import make_advanced_shipment
        _ensure_statuses()
        _seed_rules()
        user = _make_user('doc', 'document_team')
        shipment = make_advanced_shipment(user)
        trip = make_trip(integration_trip_id='b242b4de-a941-4dba-899e-3b0235e9f4ec')
        ExternalTrip.objects.filter(pk=trip.pk).update(shipment=shipment)
        type(shipment).objects.filter(pk=shipment.pk).update(trip_id=trip.pk)
        trip.refresh_from_db()
        trip.driver_full_name = 'Täze Sürüji'
        trip.save()
        self.assertEqual(apply_trip_change(trip, user), 'applied_rollback')
        shipment.refresh_from_db()
        self.assertEqual(shipment.status.code, 'draft')
        self.assertEqual(shipment.driver_name, 'Täze Sürüji')


class PollWiringTests(TestCase):
    def test_poll_releases_cancelled_then_applies_every_pending_change(self):
        from unittest import mock

        from apps.transport import tasks
        trip = make_trip()
        with mock.patch.object(tasks, 'sync_external_trips', return_value=[]), \
                mock.patch.object(tasks, 'find_pending_changes', return_value=[trip]), \
                mock.patch.object(tasks, 'release_cancelled_shipments') as release, \
                mock.patch.object(tasks, 'apply_trip_change') as apply_change:
            result = tasks.poll_external_trips()
        release.assert_called_once()
        self.assertEqual(apply_change.call_args.args[0], trip)
        self.assertEqual(result, {'ok': True, 'changed': 1})

    def test_poll_401_alerts_admin_once_per_hour(self):
        from unittest import mock

        from apps.transport import tasks
        from apps.transport.services.trips_client import TripsApiUnavailable
        User.objects.create_user(username='adm', password='x', role='admin')
        with mock.patch.object(tasks, 'sync_external_trips', side_effect=TripsApiUnavailable('401', 401)):
            tasks.poll_external_trips()
            tasks.poll_external_trips()
        self.assertEqual(Notification.objects.filter(user__username='adm').count(), 1)


class PendingChangeTests(TestCase):
    """I-1: a change whose apply was lost (crash, closed season...) is found again next tick."""

    def setUp(self):
        self.user = User.objects.create_user(username='em', password='x', role='export_manager')
        kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.shipment = _make_shipment(country=kz)
        self.trip = make_trip()
        assign_trip(self.trip, self.shipment, self.user)

    def test_snapshot_ahead_of_shipment_is_pending_until_applied(self):
        from apps.transport.services.trip_changes import find_pending_changes
        ExternalTrip.objects.filter(pk=self.trip.pk).update(driver_full_name='Taze Suruji')
        self.assertEqual([t.pk for t in find_pending_changes()], [self.trip.pk])
        apply_trip_change(self.trip, self.user)
        self.assertEqual(find_pending_changes(), [])

    def test_recorded_conflict_is_not_pending_again(self):
        from apps.transport.services.trip_changes import find_pending_changes
        ExternalTrip.objects.filter(pk=self.trip.pk).update(driver_full_name='X', conflict_kind='changed', conflict_note='locked')
        self.assertEqual(find_pending_changes(), [])

    def test_cancelled_linked_trip_is_pending(self):
        from apps.transport.services.trip_changes import find_pending_changes
        ExternalTrip.objects.filter(pk=self.trip.pk).update(status='CANCELLED')
        self.assertEqual(len(find_pending_changes()), 1)

    def test_move_of_unknown_country_trip_needs_confirm(self):
        ExternalTrip.objects.filter(pk=self.trip.pk).update(destination_country_code=None)
        other = _make_shipment(code='T-2', country=self.shipment.country)
        with self.assertRaises(AssignmentError) as ctx:
            move_trip(self.trip, other, self.user)
        self.assertEqual(ctx.exception.code, 'country_unknown')
        move_trip(self.trip, other, self.user, confirm_unknown_country=True)
        other.refresh_from_db()
        self.assertEqual(other.trip_id, self.trip.pk)


class AcceptCancelledTripTests(TestCase):
    def test_accepting_a_cancelled_trip_on_a_departed_shipment_keeps_choose_truck_closed(self):
        from apps.export.models import Task, TaskState
        from apps.export.services.task_rules import generate_tasks_for_status
        from apps.export.tests_auto_advance import _ensure_statuses, _seed_rules
        _ensure_statuses()
        _seed_rules()
        user = User.objects.create_user(username='em', password='x', role='export_manager')
        kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        # A full destination closes 5b, so choose_truck exists (PREP chain, 2026-09-30).
        from apps.core.models import Customer, ImportFirm
        shipment = _make_shipment(country=kz, customer=Customer.objects.create(name='C'),
                                  import_firm=ImportFirm.objects.create(name_company='IF', country=kz))
        generate_tasks_for_status(shipment, 'draft')
        trip = make_trip()
        assign_trip(trip, shipment, user)
        task = Task.objects.get(shipment=shipment, rule__title_key='tasks.choose_truck')
        self.assertEqual(task.state, TaskState.DONE)
        departed = ShipmentStatusType.objects.get(code='yola_chykdy')
        type(shipment).objects.filter(pk=shipment.pk).update(status=departed)
        ExternalTrip.objects.filter(pk=trip.pk).update(status='CANCELLED')
        self.assertEqual(apply_trip_change(trip, user), 'conflict')
        accept_trip_change(trip, user)
        task.refresh_from_db()
        # The shipment already left: the board lists drafts only, so a reopened
        # choose_truck could never be done — it stays closed.
        self.assertEqual(task.state, TaskState.DONE)
        shipment.refresh_from_db()
        self.assertIsNone(shipment.trip_id)


class RollbackMarkOnTheTruckBoardTests(TestCase):
    def test_a_linked_trip_carries_the_shipments_rollback_stamp(self):
        from apps.transport.serializers_trips import ExternalTripSerializer
        shipment = _make_shipment(documents_reset_at=timezone.now())
        trip = make_trip(shipment=shipment)
        self.assertIsNotNone(ExternalTripSerializer(trip).data['shipment_documents_reset_at'])
        self.assertIsNone(ExternalTripSerializer(make_trip(integration_trip_id='00000000-0000-0000-0000-000000000001')).data['shipment_documents_reset_at'])
