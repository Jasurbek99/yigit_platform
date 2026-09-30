"""Demo helper (mock mode): edit the fixture so the next poll sees a change."""
import json

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.transport.services.trips_client import FIXTURE_PATH


class Command(BaseCommand):
    help = 'Change or cancel a trip in the mock fixture; the next poll applies it.'

    def add_arguments(self, parser):
        parser.add_argument('trip_uuid')
        parser.add_argument('--driver')
        parser.add_argument('--tractor')
        parser.add_argument('--trailer')
        parser.add_argument('--cancel', action='store_true')

    def handle(self, *args, **opts):
        data = json.loads(FIXTURE_PATH.read_text(encoding='utf-8'))
        item = next((i for i in data['items'] if i['integrationTripId'] == opts['trip_uuid']), None)
        if item is None:
            raise CommandError(f"No trip {opts['trip_uuid']} in {FIXTURE_PATH}")
        if opts['driver']:
            item['driver']['fullName'] = opts['driver']
        if opts['tractor']:
            item['tractor']['plateNumber'] = opts['tractor']
        if opts['trailer']:
            item['trailer']['plateNumber'] = opts['trailer']
        if opts['cancel']:
            item['status'] = 'CANCELLED'
        item['changedAt'] = timezone.now().isoformat()
        FIXTURE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
        self.stdout.write(self.style.SUCCESS(f"Updated {opts['trip_uuid']}; run poll_external_trips"))
