from django.db import models
from apps.core.db_utils import schema_table


class WeeklyTruckAllocation(models.Model):
    """Daily truck allocation per (season, week, year, day).

    One row per day. Truck counts per destination stored in TruckDestinationSplit.
    total_trucks_calc is stored (planned_kg / 18500) for fast reads.

    DDL: export.weekly_truck_allocations
    UNIQUE (season_id, week_number, year, day_of_week)
    """

    # === Identity ===
    season = models.ForeignKey('core.Season', on_delete=models.PROTECT, db_column='season_id')
    week_number = models.PositiveSmallIntegerField()
    year = models.PositiveSmallIntegerField()
    # 1=Monday through 6=Saturday
    day_of_week = models.PositiveSmallIntegerField()

    # === Planned volume ===
    total_planned_kg = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # Stored computed value: total_planned_kg / 18500
    total_trucks_calc = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    # === Audit ===
    decided_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='decided_by', related_name='truck_allocations_decided',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'weekly_truck_allocations')
        unique_together = [('season', 'week_number', 'year', 'day_of_week')]
        ordering = ['year', 'week_number', 'day_of_week']

    def __str__(self) -> str:
        return f'W{self.week_number}/{self.year} day={self.day_of_week} — {self.total_trucks_calc} trucks'


class TruckDestinationSplit(models.Model):
    """Truck count per destination per day.

    Links to WeeklyTruckAllocation (the day) and TruckDestination (the destination).
    One row per (allocation, destination).
    """

    truck_allocation = models.ForeignKey(
        WeeklyTruckAllocation,
        on_delete=models.CASCADE,
        related_name='destination_splits',
    )
    destination = models.ForeignKey(
        'core.TruckDestination',
        on_delete=models.PROTECT,
        related_name='truck_splits',
    )
    truck_count = models.IntegerField(default=0)

    class Meta:
        db_table = schema_table('export', 'truck_destination_splits')
        constraints = [
            models.UniqueConstraint(
                fields=['truck_allocation', 'destination'],
                name='uq_truck_dest_split',
            ),
            models.CheckConstraint(
                check=models.Q(truck_count__gte=0),
                name='chk_truck_dest_count_gte0',
            ),
        ]
        ordering = ['destination__sort_order']

    def __str__(self) -> str:
        return f'{self.truck_allocation} — {self.destination.name}: {self.truck_count}'
