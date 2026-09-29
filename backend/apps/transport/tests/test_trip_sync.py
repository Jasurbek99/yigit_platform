from django.test import TestCase

from apps.transport.models import ExternalTrip, ExternalTripSyncState


class ExternalTripModelTests(TestCase):
    def test_sync_state_is_a_singleton(self):
        first = ExternalTripSyncState.load()
        second = ExternalTripSyncState.load()
        self.assertEqual(first.pk, second.pk)
        self.assertIsNone(first.cursor)

    def test_snapshot_fields_cover_the_change_triggers(self):
        self.assertEqual(
            ExternalTrip.SNAPSHOT_FIELDS,
            ('tractor_plate', 'trailer_plate', 'driver_full_name', 'driver_passport_number'),
        )
