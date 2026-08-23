from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class Truck(models.Model):
    """Fleet vehicle registry — one row per physical truck/trailer."""

    CATEGORY_CHOICES = [
        ('truck', 'Truck'),
        ('trailer', 'Trailer'),
        ('unknown', 'Unknown'),
    ]

    plate = models.CharField(max_length=20, unique=True)
    fleet_no = models.CharField(max_length=10, unique=True, null=True, blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='unknown')
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('transport', 'trucks')
        ordering = ['fleet_no', 'plate']

    def __str__(self) -> str:
        return f'{self.plate} ({self.fleet_no})' if self.fleet_no else self.plate


class Driver(models.Model):
    """Driver registry, seeded from Z_TIRWEB with source ids preserved."""

    name = models.CharField(max_length=100, **cyrillic_collation())
    phone = models.CharField(max_length=30, null=True, blank=True)
    # Accounting identity in the Logo system, carried over from Z_TIRWEB.
    # `driver_logo_code` ('195.02.S008') is the reliable "same person" key —
    # names are not: the source holds one person twice with the words swapped
    # (SALAROW TOYLY / TOYLY SALAROW, both 195.02.S008) and two different people
    # under one identical name (BATYROW BAYRAMMYRAT, ids 30/31, distinct codes).
    # Deliberately NOT unique: the source itself violates that today, and a
    # constraint would make the import fail instead of deduplicating.
    logo_ref = models.CharField(max_length=100, blank=True, default='')
    driver_logo_code = models.CharField(max_length=120, blank=True, default='')
    # Absent from the import's upsert defaults on purpose, so a deactivate
    # survives a re-run. That is what makes deactivation — not deletion — the
    # right way to retire a duplicate: Z_TIRWEB still holds the row, so a delete
    # would simply come back on the next import.
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = schema_table('transport', 'drivers')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class TraccarDevice(models.Model):
    """Maps a Traccar GPS device to one of our trucks."""

    traccar_id = models.IntegerField(unique=True)
    imei = models.CharField(max_length=32, null=True, blank=True)
    name = models.CharField(max_length=100, **cyrillic_collation())
    category = models.CharField(max_length=20, null=True, blank=True)
    truck = models.ForeignKey(
        Truck, on_delete=models.PROTECT, null=True, blank=True, related_name='devices',
    )
    status = models.CharField(max_length=10, default='unknown')
    last_seen = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = schema_table('transport', 'traccar_devices')
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class DevicePosition(models.Model):
    """Latest known position for a device — one row per device, upserted."""

    device = models.OneToOneField(
        TraccarDevice, on_delete=models.CASCADE, related_name='position',
    )
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    speed = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    course = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    address = models.CharField(max_length=300, null=True, blank=True, **cyrillic_collation())
    ignition = models.BooleanField(null=True, blank=True)
    fix_time = models.DateTimeField(null=True, blank=True)
    valid = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = schema_table('transport', 'device_positions')

    def __str__(self) -> str:
        return f'{self.device.name} @ {self.fix_time}'
