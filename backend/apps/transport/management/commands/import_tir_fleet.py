from django.core.management.base import BaseCommand

from apps.transport.services.tir_client import TirUnavailable
from apps.transport.services.tir_import import import_fleet


class Command(BaseCommand):
    help = 'ONE-TIME import of TruckHead/Trailer/Driver from the Z_TIRWEB TIR DB (read-only). Idempotent.'

    def handle(self, *args, **options):
        try:
            result = import_fleet()
        except TirUnavailable as exc:
            self.stdout.write(self.style.ERROR(f'Z_TIRWEB unavailable: {exc}'))
            return
        self.stdout.write(self.style.SUCCESS(
            f"Imported {result['truck_heads']} truck heads, "
            f"{result['trailers']} trailers, {result['drivers']} drivers."
        ))
