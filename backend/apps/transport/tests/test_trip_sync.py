from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from apps.core.models import Season, ShipmentStatusType
from apps.export.models import Shipment
from apps.transport.models import ExternalTrip, ExternalTripSyncState
from apps.transport.services.trip_sync import OVERLAP, sync_external_trips
from apps.transport.services.trips_client import MockTripsClient, TripsApiUnavailable


def _make_shipment(code='T-1', status_code='draft', **fields):
    status, _ = ShipmentStatusType.objects.get_or_create(
        code=status_code, defaults={'name_tk': status_code, 'step_order': 99},
    )
    season = Season.objects.filter(is_active=True).first() or Season.objects.create(
        name='S', start_date='2026-09-01', end_date='2027-06-30', is_active=True)
    return Shipment.objects.create(shipment_code=code, date='2026-10-01', season=season, status=status, **fields)


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



class FakeClient(MockTripsClient):
    """MockTripsClient whose items the test controls."""

    def __init__(self, items):
        self.items = items
        self.detail_calls = []
        self.since_seen = []

    def _items(self):
        return self.items

    def list_trips(self, changed_since, page, page_size=200):
        self.since_seen.append(changed_since)
        return super().list_trips(changed_since, page, page_size)

    def get_trip(self, trip_uuid):
        self.detail_calls.append(trip_uuid)
        return {**next(i for i in self.items if i['integrationTripId'] == trip_uuid),
                'destinationCountryCode': 'KZ'}


def _fixture_items():
    return MockTripsClient()._items()


class SyncTests(TestCase):
    def test_first_sync_creates_all_and_moves_cursor(self):
        sync_external_trips(FakeClient(_fixture_items()))
        self.assertEqual(ExternalTrip.objects.count(), 6)
        state = ExternalTripSyncState.load()
        self.assertEqual(state.cursor.isoformat(), '2026-09-29T11:02:11.137529+00:00')
        self.assertIsNotNone(state.last_success_at)

    def test_second_sync_asks_with_overlap_and_is_idempotent(self):
        client = FakeClient(_fixture_items())
        sync_external_trips(client)
        sync_external_trips(client)
        cursor = ExternalTripSyncState.load().cursor
        self.assertEqual(client.since_seen[-1], cursor - OVERLAP)
        self.assertEqual(ExternalTrip.objects.count(), 6)

    def test_paging_reads_every_page(self):
        client = FakeClient(_fixture_items())
        with mock.patch('apps.transport.services.trip_sync.PAGE_SIZE', 4):
            sync_external_trips(client)
        self.assertEqual(ExternalTrip.objects.count(), 6)

    def test_missing_country_is_filled_from_detail_once(self):
        items = [{**i, 'destinationCountryCode': None} for i in _fixture_items()[:1]]
        client = FakeClient(items)
        sync_external_trips(client)
        sync_external_trips(client)
        self.assertEqual(ExternalTrip.objects.get().destination_country_code, 'KZ')
        self.assertEqual(len(client.detail_calls), 1)

    def test_failure_keeps_cursor_and_records_error(self):
        client = FakeClient(_fixture_items())
        sync_external_trips(client)
        cursor = ExternalTripSyncState.load().cursor
        client.list_trips = mock.Mock(side_effect=TripsApiUnavailable('down'))
        with self.assertRaises(TripsApiUnavailable):
            sync_external_trips(client)
        state = ExternalTripSyncState.load()
        self.assertEqual(state.cursor, cursor)
        self.assertIn('down', state.last_error)


class ChangeDetectionTests(TestCase):
    """Review Focus 5: status-only bumps are not changes."""

    def _linked(self, client):
        sync_external_trips(client)
        trip = ExternalTrip.objects.get(tractor_plate='2563AHF')
        # Linking needs a shipment; a bare id is enough for detection.
        ExternalTrip.objects.filter(pk=trip.pk).update(shipment_id=_make_shipment().pk)
        return trip

    def _bump(self, items, **changes):
        item = items[0]
        item['changedAt'] = (timezone.now() + timedelta(minutes=1)).isoformat()
        for path, value in changes.items():
            block, _, key = path.partition('.')
            if key:
                item[block][key] = value
            else:
                item[block] = value

    def test_status_only_bump_is_not_a_change(self):
        items = _fixture_items()
        client = FakeClient(items)
        self._linked(client)
        self._bump(items, status='PLANNED')
        self.assertEqual(sync_external_trips(client), [])
        self.assertEqual(ExternalTrip.objects.get(tractor_plate='2563AHF').status, 'PLANNED')

    def test_driver_swap_is_a_change(self):
        items = _fixture_items()
        client = FakeClient(items)
        self._linked(client)
        self._bump(items, **{'driver.fullName': 'Täze Sürüji'})
        self.assertEqual(len(sync_external_trips(client)), 1)

    def test_cancel_is_a_change(self):
        items = _fixture_items()
        client = FakeClient(items)
        self._linked(client)
        self._bump(items, status='CANCELLED')
        self.assertEqual(len(sync_external_trips(client)), 1)

    def test_unlinked_trip_change_is_not_reported(self):
        items = _fixture_items()
        client = FakeClient(items)
        sync_external_trips(client)
        self._bump(items, **{'driver.fullName': 'X'})
        self.assertEqual(sync_external_trips(client), [])


class SyncRobustnessTests(TestCase):
    def test_one_bad_item_is_skipped_and_reported(self):
        items = _fixture_items()
        del items[1]['tractor']
        sync_external_trips(FakeClient(items))
        self.assertEqual(ExternalTrip.objects.count(), 5)
        self.assertIn('b242b4de', ExternalTripSyncState.load().last_error)
        self.assertIsNotNone(ExternalTripSyncState.load().cursor)

    def test_failed_detail_call_keeps_country_empty_and_goes_on(self):
        items = [{**i, 'destinationCountryCode': None} for i in _fixture_items()[:2]]
        client = FakeClient(items)
        client.get_trip = mock.Mock(side_effect=TripsApiUnavailable('404', 404))
        sync_external_trips(client)
        self.assertEqual(ExternalTrip.objects.filter(destination_country_code__isnull=True).count(), 2)

    def test_upsert_never_writes_our_own_columns(self):
        """I-3: a poll racing an assign must not write shipment/conflict/push columns back."""
        client = FakeClient(_fixture_items())
        sync_external_trips(client)
        saved = []
        original = ExternalTrip.save

        def spy(instance, *args, **kwargs):
            saved.append(kwargs.get('update_fields'))
            return original(instance, *args, **kwargs)

        client.items[0]['changedAt'] = (timezone.now() + timedelta(minutes=1)).isoformat()
        with mock.patch.object(ExternalTrip, 'save', spy):
            sync_external_trips(client)
        self.assertTrue(saved)
        for fields in saved:
            self.assertIsNotNone(fields)
            self.assertNotIn('shipment', fields)
            self.assertNotIn('conflict_note', fields)

    def test_pages_continue_from_the_last_changed_at(self):
        """I-4: keyset paging, so a trip changing mid-run cannot shift a row off a page."""
        from django.utils.dateparse import parse_datetime
        client = FakeClient(_fixture_items())
        pages_seen = []
        original = client.list_trips

        def spy(changed_since, page, page_size=200):
            pages_seen.append(page)
            return original(changed_since, page, page_size)

        client.list_trips = spy
        with mock.patch('apps.transport.services.trip_sync.PAGE_SIZE', 4):
            sync_external_trips(client)
        self.assertEqual(ExternalTrip.objects.count(), 6)
        fourth = sorted(i['changedAt'] for i in client.items)[3]
        self.assertEqual(client.since_seen[1], parse_datetime(fourth) - timedelta(microseconds=1))
        self.assertEqual(pages_seen, [1, 1])


class CountryDetailOnceTests(TestCase):
    def test_null_country_is_not_re_asked_until_the_trip_changes(self):
        items = [{**i, 'destinationCountryCode': None} for i in _fixture_items()[:1]]
        client = FakeClient(items)
        client.get_trip = mock.Mock(return_value={'destinationCountryCode': None})
        sync_external_trips(client)
        sync_external_trips(client)
        self.assertEqual(client.get_trip.call_count, 1)
        items[0]['changedAt'] = (timezone.now() + timedelta(minutes=1)).isoformat()
        sync_external_trips(client)
        self.assertEqual(client.get_trip.call_count, 2)


class CountryDetailRetryTests(TestCase):
    def test_failed_lookup_is_asked_again_next_poll(self):
        items = [{**i, 'destinationCountryCode': None} for i in _fixture_items()[:1]]
        client = FakeClient(items)
        client.get_trip = mock.Mock(side_effect=[TripsApiUnavailable('timeout'), {'destinationCountryCode': 'RU'}])
        sync_external_trips(client)
        self.assertIsNone(ExternalTrip.objects.get().destination_country_code)
        sync_external_trips(client)
        self.assertEqual(ExternalTrip.objects.get().destination_country_code, 'RU')
