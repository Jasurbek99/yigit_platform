from django.core.management.base import BaseCommand

from apps.transport.services.sync import sync_devices
from apps.transport.services.traccar_client import TraccarUnavailable


class Command(BaseCommand):
    help = 'One-time (idempotent) seed of Truck + TraccarDevice rows from Traccar.'

    def handle(self, *args, **options):
        try:
            count = sync_devices()
        except TraccarUnavailable as exc:
            self.stdout.write(self.style.ERROR(f'Traccar unavailable: {exc}'))
            return
        self.stdout.write(self.style.SUCCESS(f'Synced {count} devices.'))
