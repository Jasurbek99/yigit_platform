"""Daily-grain harvest data: plan, forecast, and actual values per block per day."""
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class HarvestDayEntry(models.Model):
    """One row per (weekly_plan, entry_date) carrying plan/forecast/actual values.

    Replaces the 12 wide columns on WeeklyHarvestPlan. Each cell in the 15-block × 6-day
    grid maps to exactly one HarvestDayEntry row.

    Empty-vs-zero semantics:
    - value IS NULL → "not entered" (render as em-dash).
    - value = 0 AND *_submitted_at IS NOT NULL → explicit confirmed zero (italic style).

    Plan state is computed from the submission time relative to GreenhouseConfig deadlines:
    on_time / late / critical_late.

    Forecast window identifies which time slot the forecast was entered in:
    primary / fallback / same_day_red_flag. None means locked (after same_day_close).

    DDL: export.harvest_day_entries
    UNIQUE: (weekly_plan, entry_date)
    """

    # === Parent container ===
    weekly_plan = models.ForeignKey(
        'greenhouse.WeeklyHarvestPlan',
        on_delete=models.CASCADE,
        db_column='weekly_plan_id',
        related_name='day_entries',
    )
    season = models.ForeignKey(
        'core.Season',
        on_delete=models.PROTECT,
        db_column='season_id',
    )
    block = models.ForeignKey(
        'core.GreenhouseBlock',
        on_delete=models.PROTECT,
        db_column='block_id',
    )
    entry_date = models.DateField(help_text='Local date (Asia/Ashgabat) this entry covers.')
    weekday = models.PositiveSmallIntegerField(
        help_text='0=Mon … 6=Sun. Sunday is allowed for end-of-season harvesting.',
    )

    # === Plan ===
    plan_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text='Planned harvest kg. NULL = not entered.',
    )
    plan_submitted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='UTC timestamp when plan_value was submitted.',
    )
    plan_submitted_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column='plan_submitted_by',
        related_name='+',
    )
    plan_state = models.CharField(
        max_length=16,
        blank=True,
        default='',
        choices=[
            ('on_time', 'on_time'),
            ('late', 'late'),
            ('critical_late', 'critical_late'),
        ],
        help_text='Timeliness of plan submission relative to config deadlines.',
    )

    # === Forecast ===
    forecast_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text='Forecast harvest kg. NULL = not entered.',
    )
    forecast_submitted_at = models.DateTimeField(null=True, blank=True)
    forecast_submitted_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column='forecast_submitted_by',
        related_name='+',
    )
    forecast_window = models.CharField(
        max_length=24,
        blank=True,
        default='',
        choices=[
            ('primary', 'primary'),
            ('fallback', 'fallback'),
            ('same_day_red_flag', 'same_day_red_flag'),
        ],
        help_text='Which time window the forecast was submitted in.',
    )
    forecast_revision_count = models.PositiveSmallIntegerField(
        default=0,
        help_text='Number of times the forecast value has been revised (first entry = 0).',
    )

    # === Actual ===
    actual_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text='Actual harvest kg. NULL = not yet recorded.',
    )
    actual_finalized_at = models.DateTimeField(null=True, blank=True)
    actual_source = models.CharField(
        max_length=24,
        blank=True,
        default='',
        choices=[
            ('manual', 'manual'),
            ('pallet_rollup_pending', 'pallet_rollup_pending'),
            ('admin_override', 'admin_override'),
            ('shipment_rollup', 'shipment_rollup'),
        ],
        help_text='How actual_value was set. shipment_rollup is the daily '
                  'computed source; admin_override marks a value the rollup '
                  'must leave alone.',
    )

    # === Daily board (Ýük plan we galyndy page) ===
    # The daily harvest board lets any page-authorised user record the carried-over
    # remainder from the previous day plus a freeform note, alongside today's plan
    # (which reuses forecast_value). These bypass the forecast role/window gates.
    yesterday_rest_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Düýnki galyndy — remainder carried over from the previous day (kg). NULL = not entered.",
    )
    daily_note = models.CharField(
        max_length=500,
        blank=True,
        default='',
        **cyrillic_collation(),
        help_text='Bellik — freeform daily-board note (Cyrillic/Latin mixed).',
    )
    daily_entered_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='UTC timestamp of the last daily-board write (Girizilen senesi).',
    )
    daily_entered_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column='daily_entered_by',
        related_name='+',
        help_text='User who last wrote a daily-board value (Girizildi).',
    )

    # === Last admin-override snapshot (full history in AuditLog) ===
    last_override_at = models.DateTimeField(null=True, blank=True)
    last_override_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column='last_override_by',
        related_name='+',
    )
    last_override_reason = models.CharField(
        max_length=500,
        blank=True,
        default='',
        **cyrillic_collation(),
        help_text='Most-recent admin override reason (Cyrillic/Latin mixed).',
    )

    # === Timestamps ===
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = schema_table('export', 'harvest_day_entries')
        constraints = [
            models.UniqueConstraint(
                fields=['weekly_plan', 'entry_date'],
                name='uq_hde_plan_date',
            ),
            models.CheckConstraint(
                check=models.Q(weekday__gte=0) & models.Q(weekday__lte=6),
                name='chk_hde_weekday',
            ),
            models.CheckConstraint(
                check=models.Q(plan_value__isnull=True) | models.Q(plan_value__gte=0),
                name='chk_hde_plan_gte0',
            ),
            models.CheckConstraint(
                check=models.Q(forecast_value__isnull=True) | models.Q(forecast_value__gte=0),
                name='chk_hde_fc_gte0',
            ),
            models.CheckConstraint(
                check=models.Q(actual_value__isnull=True) | models.Q(actual_value__gte=0),
                name='chk_hde_act_gte0',
            ),
            models.CheckConstraint(
                check=models.Q(yesterday_rest_value__isnull=True) | models.Q(yesterday_rest_value__gte=0),
                name='chk_hde_rest_gte0',
            ),
        ]
        indexes = [
            models.Index(fields=['block', 'entry_date'], name='ix_hde_block_date'),
            models.Index(fields=['entry_date'], name='ix_hde_date'),
            models.Index(fields=['season', 'entry_date'], name='ix_hde_season_date'),
        ]
        ordering = ['entry_date', 'block__code']

    def __str__(self) -> str:
        return f'HarvestDayEntry block={self.block_id} date={self.entry_date}'
