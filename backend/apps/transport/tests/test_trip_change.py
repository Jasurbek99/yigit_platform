from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.core.models import Country, ShipmentStatusType
from apps.export.models import Notification, ShipmentComment
from apps.transport.models import ExternalTrip
from apps.transport.services.trip_assignment import (
    AssignmentError, accept_trip_change, apply_trip_change, assign_trip, move_trip, unassign_trip,
)
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
        self.assertIsNone(self.trip.shipment_id)


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
    def test_poll_releases_cancelled_then_applies_each_change(self):
        from unittest import mock

        from apps.transport import tasks
        trip = make_trip()
        with mock.patch.object(tasks, 'sync_external_trips', return_value=[trip]), \
                mock.patch.object(tasks, 'release_cancelled_shipments') as release, \
                mock.patch.object(tasks, 'apply_trip_change') as apply_change:
            result = tasks.poll_external_trips()
        release.assert_called_once()
        apply_change.assert_called_once()
        self.assertEqual(apply_change.call_args.args[0], trip)
        self.assertEqual(result, {'ok': True, 'changed': 1})
