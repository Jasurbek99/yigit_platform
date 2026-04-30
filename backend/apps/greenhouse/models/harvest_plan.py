from django.db import models
from apps.core.db_utils import schema_table


class WeeklyHarvestPlan(models.Model):
    """Per-week submission container for one greenhouse block.

    Wide columns (monday_plan_kg…saturday_actual_kg) and approval workflow
    were dropped in migration `greenhouse.0004_harvestdayentry_harvestdispatchlog_and_more`.
    Daily plan/forecast/actual data lives in `HarvestDayEntry` (related_name='day_entries').

    DDL: export.weekly_harvest_plans -- UNIQUE (season_id, block_id, week_number, year)
    """

    # === Identity ===
    season = models.ForeignKey('core.Season', on_delete=models.PROTECT, db_column='season_id')
    block = models.ForeignKey('core.GreenhouseBlock', on_delete=models.PROTECT, db_column='block_id')
    week_number = models.PositiveSmallIntegerField(help_text='ISO week number 1–53.')
    year = models.PositiveSmallIntegerField(help_text='ISO year.')

    # === Submission ===
    submitted_at = models.DateTimeField(
        null=True, blank=True,
        help_text='UTC timestamp of first formal submission for this week.',
    )
    submitted_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='submitted_by', related_name='harvest_plans_submitted',
    )

    # === Lock ===
    locked_at = models.DateTimeField(
        null=True, blank=True,
        help_text='When set, all edits are frozen. Admin can re-open by clearing to NULL.',
    )

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
        ]
        ordering = ['year', 'week_number', 'block']

    def __str__(self) -> str:
        return f'W{self.week_number}/{self.year} — block {self.block_id}'
