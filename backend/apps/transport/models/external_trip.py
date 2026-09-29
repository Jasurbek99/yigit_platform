from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class ExternalTrip(models.Model):
    """Local mirror of one trip planned in the external Planning system.

    Planning owns the row's truth; only the poller overwrites it. `shipment`
    is OUR link (spec 2026-09-29-transport-trips §5) and survives re-polls.
    """

    SNAPSHOT_FIELDS = ('tractor_plate', 'trailer_plate', 'driver_full_name', 'driver_passport_number')
    CLOSED_STATUSES = ('CANCELLED', 'CLOSED', 'ARCHIVED')

    # === Identity ===
    integration_trip_id = models.UUIDField(unique=True)
    trip_number = models.CharField(max_length=50, null=True, blank=True)
    status = models.CharField(max_length=30)
    planned_departure = models.DateField()
    changed_at = models.DateTimeField()
    destination_country_code = models.CharField(max_length=5, null=True, blank=True)

    # === Tractor ===
    tractor_plate = models.CharField(max_length=50)
    tractor_brand = models.CharField(max_length=100, null=True, blank=True)
    tractor_model = models.CharField(max_length=100, null=True, blank=True)
    tractor_company = models.CharField(max_length=200, null=True, blank=True, **cyrillic_collation())
    tractor_source = models.CharField(max_length=20)

    # === Trailer ===
    trailer_plate = models.CharField(max_length=50)
    trailer_brand = models.CharField(max_length=100, null=True, blank=True)
    trailer_model = models.CharField(max_length=100, null=True, blank=True)
    trailer_company = models.CharField(max_length=200, null=True, blank=True, **cyrillic_collation())
    trailer_source = models.CharField(max_length=20)

    # === Driver ===
    driver_full_name = models.CharField(max_length=200, **cyrillic_collation())
    driver_phone = models.CharField(max_length=30, null=True, blank=True)
    driver_passport_number = models.CharField(max_length=50, null=True, blank=True)
    driver_passport_expiry = models.DateField(null=True, blank=True)
    # "Country:YYYY-MM-DD;Country:YYYY-MM-DD" — no JSONField on MSSQL.
    driver_visas = models.CharField(max_length=500, blank=True, default='', **cyrillic_collation())
    driver_source = models.CharField(max_length=20)

    # === Our side ===
    shipment = models.OneToOneField(
        'export.Shipment', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='external_trip',
    )
    conflict_note = models.TextField(null=True, blank=True, **cyrillic_collation())
    last_push_status = models.CharField(max_length=20, null=True, blank=True)
    last_push_error = models.TextField(null=True, blank=True)
    # What we last enqueued for export-code — compared on every poll tick so a
    # correction is pushed once, not every 2 minutes until Planning echoes it.
    last_pushed_export_code = models.CharField(max_length=30, null=True, blank=True)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = schema_table('transport', 'external_trips')
        ordering = ['planned_departure', 'id']

    def __str__(self) -> str:
        return f'{self.tractor_plate}/{self.trailer_plate} {self.planned_departure}'


class ExternalTripSyncState(models.Model):
    """Single row: poll cursor + health for the 'synced N min ago' line."""

    cursor = models.DateTimeField(null=True, blank=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default='')
    last_auth_alert_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = schema_table('transport', 'external_trip_sync_state')

    @classmethod
    def load(cls) -> 'ExternalTripSyncState':
        state, _ = cls.objects.get_or_create(pk=1)
        return state
