"""Idempotency log for the harvest dispatcher management command."""
from django.db import models

from apps.core.db_utils import schema_table


class HarvestDispatchLog(models.Model):
    """Record of a dispatcher trigger firing for a specific (kind, user, date).

    The UNIQUE(trigger_kind, target_user, scope_date) constraint is the idempotency
    key: if the management command runs twice within the same 5-minute window, the
    second attempt raises IntegrityError on get_or_create and the trigger is skipped.

    trigger_kind choices:
      t1_forecast_nudge        — notify block manager of upcoming forecast window
      t2_forecast_handoff      — notify warehouse_chief at primary window close
      t3_forecast_escalation   — urgent escalation at fallback window close
      p1_plan_reminder         — Friday: plan not yet submitted for next week
      p2_plan_late             — Saturday: plan still missing
      p3_plan_critical_late    — Monday: plan critical-late, escalate to admin

    DDL: export.harvest_dispatch_log
    UNIQUE: (trigger_kind, target_user, scope_date)
    """

    TRIGGER_KIND_CHOICES = [
        ('t1_forecast_nudge', 'T1 Forecast Nudge'),
        ('t2_forecast_handoff', 'T2 Forecast Handoff'),
        ('t3_forecast_escalation', 'T3 Forecast Escalation'),
        ('p1_plan_reminder', 'P1 Plan Reminder'),
        ('p2_plan_late', 'P2 Plan Late'),
        ('p3_plan_critical_late', 'P3 Plan Critical-Late'),
    ]

    trigger_kind = models.CharField(max_length=30, choices=TRIGGER_KIND_CHOICES)
    target_user = models.ForeignKey(
        'core.User',
        on_delete=models.CASCADE,
        db_column='target_user_id',
        related_name='+',
    )
    scope_date = models.DateField(
        help_text='The date this trigger is scoped to (tomorrow for forecasts, plan-week-start for plan triggers).',
    )
    fired_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'harvest_dispatch_log')
        constraints = [
            models.UniqueConstraint(
                fields=['trigger_kind', 'target_user', 'scope_date'],
                name='uq_harvest_dispatch_log',
            ),
        ]
        ordering = ['-fired_at']

    def __str__(self) -> str:
        return f'{self.trigger_kind} → user={self.target_user_id} scope={self.scope_date}'
