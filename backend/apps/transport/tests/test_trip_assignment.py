from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.core.models import Country
from apps.transport.models import ExternalTrip, TruckHead
from apps.transport.services.trip_assignment import AssignmentError, assign_trip, unassign_trip
from apps.transport.tests.test_trip_sync import _make_shipment

User = get_user_model()


def make_trip(**overrides):
    fields = dict(
        integration_trip_id='89f2783b-e7e9-47ba-9884-8fe7bf34f1bd', status='CREATED',
        planned_departure='2026-10-11', changed_at='2026-09-28T16:15:18+00:00',
        destination_country_code='KZ', tractor_plate='2563AHF', tractor_source='GARAGE',
        trailer_plate='2251TAH', trailer_source='GARAGE', driver_full_name='Amandurdyyew Atajan',
        driver_phone='99361202698', driver_passport_number='A2510574',
        driver_passport_expiry='2029-04-08', driver_source='GARAGE',
    )
    fields.update(overrides)
    return ExternalTrip.objects.create(**fields)


class AssignTripTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='em', password='x', role='export_manager')
        self.kz = Country.objects.create(code='KZ', name_tk='GAZAGYSTAN')
        self.ru = Country.objects.create(code='RU', name_tk='RUSSIYA')
        self.shipment = _make_shipment(country=self.kz)
        self.trip = make_trip()

    def test_assign_writes_shipment_fields_and_link(self):
        assign_trip(self.trip, self.shipment, self.user)
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertEqual(self.shipment.truck_plate, '2563AHF/2251TAH')
        self.assertEqual(self.shipment.driver_name, 'Amandurdyyew Atajan')
        self.assertEqual(self.shipment.driver_phone, '99361202698')
        self.assertEqual(self.shipment.driver_passport_serial, 'A2510574')
        self.assertEqual(str(self.shipment.driver_passport_issue_date), '2029-04-08')
        self.assertEqual(self.shipment.trip_id, self.trip.pk)
        self.assertIsNone(self.shipment.driver_id)
        self.assertEqual(self.trip.shipment_id, self.shipment.pk)

    def test_assign_links_our_truck_head_by_normalised_plate(self):
        head = TruckHead.objects.create(plate_number='2563 ahf')
        assign_trip(self.trip, self.shipment, self.user)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.truck_head_id, head.pk)

    def test_country_mismatch_refused(self):
        self.shipment.country = self.ru
        self.shipment.save()
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, self.shipment, self.user)
        self.assertEqual(ctx.exception.code, 'country_mismatch')

    def test_unknown_country_needs_confirm(self):
        self.trip.destination_country_code = None
        self.trip.save()
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, self.shipment, self.user)
        self.assertEqual(ctx.exception.code, 'country_unknown')
        assign_trip(self.trip, self.shipment, self.user, confirm_unknown_country=True)
        self.shipment.refresh_from_db()
        self.assertEqual(self.shipment.trip_id, self.trip.pk)

    def test_gapy_refused(self):
        self.shipment.is_gapy_satys = True
        self.shipment.save()
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, self.shipment, self.user)
        self.assertEqual(ctx.exception.code, 'gapy')

    def test_non_draft_refused(self):
        other = _make_shipment(code='T-2', status_code='gumruk_girish', country=self.kz)
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, other, self.user)
        self.assertEqual(ctx.exception.code, 'not_draft')

    def test_trip_already_taken_refused(self):
        assign_trip(self.trip, self.shipment, self.user)
        other = _make_shipment(code='T-2', country=self.kz)
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, other, self.user)
        self.assertEqual(ctx.exception.code, 'trip_taken')

    def test_cancelled_trip_refused(self):
        self.trip.status = 'CANCELLED'
        self.trip.save()
        with self.assertRaises(AssignmentError) as ctx:
            assign_trip(self.trip, self.shipment, self.user)
        self.assertEqual(ctx.exception.code, 'trip_closed')

    def test_unassign_clears_fields_in_draft(self):
        assign_trip(self.trip, self.shipment, self.user)
        unassign_trip(self.trip, self.user)
        self.shipment.refresh_from_db()
        self.trip.refresh_from_db()
        self.assertIsNone(self.shipment.trip_id)
        self.assertFalse(self.shipment.truck_plate)
        self.assertIsNone(self.trip.shipment_id)
