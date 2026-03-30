from django.db import models
from apps.core.db_utils import schema_table, cyrillic_collation


class WeeklyTruckAllocation(models.Model):
    """Daily truck count decision per destination category.

    One row per (season, week_number, year, day_of_week). Captures total
    planned kg and the split between Russia/Kazakhstan/Gapy Satys trucks.
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

    # === Truck split ===
    russia_trucks = models.IntegerField(default=0)
    kazakhstan_trucks = models.IntegerField(default=0)
    gapy_satys_trucks = models.IntegerField(default=0)

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
        constraints = [
            models.CheckConstraint(check=models.Q(russia_trucks__gte=0), name='chk_trk_russia_gte0'),
            models.CheckConstraint(check=models.Q(kazakhstan_trucks__gte=0), name='chk_trk_kz_gte0'),
            models.CheckConstraint(check=models.Q(gapy_satys_trucks__gte=0), name='chk_trk_gapy_gte0'),
        ]

    def __str__(self) -> str:
        return f'W{self.week_number}/{self.year} day={self.day_of_week} — {self.total_trucks_calc} trucks'


class WeeklyHarvestPlan(models.Model):
    """AD-3: Weekly harvest plan per greenhouse block.

    One row per (season, block, week_number, year). Plan vs actual for Mon–Sat.
    DDL: export.weekly_harvest_plans — UNIQUE (season_id, block_id, week_number, year)
    """

    # === Identity ===
    season = models.ForeignKey('core.Season', on_delete=models.PROTECT, db_column='season_id')
    block = models.ForeignKey('core.GreenhouseBlock', on_delete=models.PROTECT, db_column='block_id')
    week_number = models.PositiveSmallIntegerField()  # ISO week 1-53
    year = models.PositiveSmallIntegerField()

    # === Plan (kg) ===
    monday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tuesday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    wednesday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    thursday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    friday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    saturday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    # === Actual (kg) ===
    monday_actual_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    tuesday_actual_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    wednesday_actual_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    thursday_actual_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    friday_actual_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    saturday_actual_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    # === Audit ===
    entered_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='entered_by', related_name='harvest_plans_entered',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = schema_table('export', 'weekly_harvest_plans')
        constraints = [
            models.UniqueConstraint(
                fields=['season', 'block', 'week_number', 'year'],
                name='uq_weekly_plan',
            ),
            models.CheckConstraint(
                check=(
                    models.Q(monday_plan_kg__gte=0) &
                    models.Q(tuesday_plan_kg__gte=0) &
                    models.Q(wednesday_plan_kg__gte=0) &
                    models.Q(thursday_plan_kg__gte=0) &
                    models.Q(friday_plan_kg__gte=0) &
                    models.Q(saturday_plan_kg__gte=0)
                ),
                name='chk_harvest_plan_kg_gte0',
            ),
        ]
        ordering = ['year', 'week_number', 'block']


class QuotaAllocation(models.Model):
    """Export quota granted to a firm for a season.

    DDL: export.quota_allocations — UNIQUE (season_id, export_firm_id)
    used_kg is updated by the finance module when shipments are settled.
    """

    season = models.ForeignKey('core.Season', on_delete=models.PROTECT, db_column='season_id')
    export_firm = models.ForeignKey(
        'core.ExportFirm', on_delete=models.PROTECT,
        db_column='export_firm_id', related_name='quota_allocations',
    )
    granted_kg = models.DecimalField(max_digits=12, decimal_places=2)
    used_kg = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    # Warning flags — set True once notification is sent to avoid repeats
    warning_80_sent = models.BooleanField(default=False)
    warning_90_sent = models.BooleanField(default=False)
    warning_95_sent = models.BooleanField(default=False)

    class Meta:
        db_table = schema_table('export', 'quota_allocations')
        constraints = [
            models.UniqueConstraint(
                fields=['season', 'export_firm'],
                name='uq_quota_season_firm',
            ),
            models.CheckConstraint(check=models.Q(used_kg__gte=0), name='chk_quota_used_kg_gte0'),
            models.CheckConstraint(check=models.Q(granted_kg__gt=0), name='chk_quota_granted_kg_gt0'),
        ]
        ordering = ['export_firm__name_en']


class PriceEntry(models.Model):
    """Market tomato price per city per day.

    DDL: export.price_entries — UNIQUE (date, city_id)
    Used by the PricePanel 7-day trend view.
    """

    date = models.DateField()
    city = models.ForeignKey('core.City', on_delete=models.PROTECT, db_column='city_id')
    price_local = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    price_usd = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)
    currency = models.CharField(max_length=10, blank=True, default='')
    source = models.CharField(max_length=30, blank=True, default='')
    entered_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='entered_by', related_name='price_entries_entered',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'price_entries')
        constraints = [
            models.UniqueConstraint(fields=['date', 'city'], name='uq_price_date_city')
        ]
        ordering = ['-date', 'city']


class DomesticMarketPrice(models.Model):
    """Domestic Turkmenistan market prices from the Satys_bahalar Excel file.

    Tracks daily tomato/vegetable prices at named bazaars (Tolkuçka, Teke bazar, etc.)
    split by price type (bazar/klent/online) and variety. Used to compare
    local TM prices against export destination prices.

    DDL: export.domestic_market_prices
    No unique constraint in DDL — an index covers (date, market_name, price_type, variety_type)
    for fast range queries.
    """

    # === When & where ===
    date = models.DateField()
    market_name = models.CharField(max_length=100, **cyrillic_collation())

    # === Classification ===
    # price_type: 'bazar', 'klent', 'online' — Latin-only codes, no collation needed
    price_type = models.CharField(max_length=30, blank=True, null=True)
    # variety_type: 'tomato_gulpakly', 'tomato_cherry', 'pepper_round', etc.
    variety_type = models.CharField(max_length=30, blank=True, null=True)

    # === Price (TMT per kg) ===
    price = models.DecimalField(max_digits=8, decimal_places=2)

    # === Audit ===
    entered_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='entered_by', related_name='domestic_prices_entered',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'domestic_market_prices')
        # Mirror the DDL index for fast date-range queries by market/type/variety
        indexes = [
            models.Index(
                fields=['date', 'market_name', 'price_type', 'variety_type'],
                name='ix_domestic_price',
            )
        ]
        ordering = ['-date', 'market_name']

    def __str__(self) -> str:
        return f'{self.date} | {self.market_name} | {self.variety_type} — {self.price} TMT/kg'
