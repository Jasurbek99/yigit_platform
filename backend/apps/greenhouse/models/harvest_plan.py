from django.db import models
from apps.core.db_utils import schema_table


PLAN_STATUS_CHOICES = [
    ('draft', 'Draft'),
    ('submitted', 'Submitted'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]

# Allowed transitions: from_status -> list of to_status values.
PLAN_TRANSITIONS = {
    'draft': ['submitted'],
    'submitted': ['approved', 'rejected'],
    'rejected': ['submitted'],
    'approved': [],
}


class WeeklyHarvestPlan(models.Model):
    """AD-3: Weekly harvest plan per greenhouse block.

    One row per (season, block, week_number, year). Plan vs actual for Mon-Sat.
    Includes approval workflow: draft -> submitted -> approved / rejected.

    DDL: export.weekly_harvest_plans -- UNIQUE (season_id, block_id, week_number, year)
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
    actual_weekly_total_kg = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text='Weekly actual total when per-day breakdown is unavailable',
    )

    # === Approval workflow ===
    status = models.CharField(max_length=20, choices=PLAN_STATUS_CHOICES, default='draft')
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='submitted_by', related_name='harvest_plans_submitted',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='approved_by', related_name='harvest_plans_approved',
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='rejected_by', related_name='harvest_plans_rejected',
    )
    rejection_note = models.CharField(max_length=500, blank=True, null=True)

    # === Audit ===
    entered_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='entered_by', related_name='harvest_plans_entered',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = schema_table('export', 'weekly_harvest_plans')
        indexes = [
            models.Index(fields=['status'], name='ix_harvest_plan_status'),
        ]
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

    def __str__(self) -> str:
        return f'W{self.week_number}/{self.year} — block {self.block_id} [{self.status}]'
