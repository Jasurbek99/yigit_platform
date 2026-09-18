"""In-week revision requests for a HarvestDayEntry plan value (ADR-024)."""
from django.db import models
from django.utils import timezone

from apps.core.db_utils import cyrillic_collation, schema_table


class PlanChangeRequest(models.Model):
    """A greenhouse manager's request to revise one day's plan after the week started.

    Holds the pending value until an export manager (or admin/boss) decides, and
    doubles as the change log: rows are never deleted, only moved out of `pending`.
    `plan_value` on the entry keeps the last APPROVED value the whole time.

    DDL: export.plan_change_requests
    """

    STATUS_PENDING = 'pending'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_SUPERSEDED = 'superseded'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'pending'),
        (STATUS_APPROVED, 'approved'),
        (STATUS_REJECTED, 'rejected'),
        (STATUS_SUPERSEDED, 'superseded'),
    ]

    # === Target cell ===
    entry = models.ForeignKey(
        'greenhouse.HarvestDayEntry',
        on_delete=models.CASCADE,
        related_name='change_requests',
    )

    # === Values ===
    baseline_value = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text='Week-start baseline at request time. NULL = empty cell (no % bound).',
    )
    current_value = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text='Approved plan_value at request time.',
    )
    requested_value = models.DecimalField(max_digits=10, decimal_places=2)
    change_pct = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        help_text='(requested - baseline) / baseline * 100. NULL when no bound applies.',
    )

    # === Workflow ===
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING)
    reason = models.CharField(max_length=500, blank=True, default='', **cyrillic_collation())
    requested_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    requested_at = models.DateTimeField(default=timezone.now)
    decided_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
        help_text='Approver/rejecter, or the user whose action superseded the request.',
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=500, blank=True, default='', **cyrillic_collation())

    class Meta:
        db_table = schema_table('export', 'plan_change_requests')
        constraints = [
            models.UniqueConstraint(
                fields=['entry'],
                condition=models.Q(status='pending'),
                name='uq_pcr_one_pending',
            ),
            models.CheckConstraint(
                check=models.Q(requested_value__gte=0),
                name='chk_pcr_requested_gte0',
            ),
        ]
        indexes = [
            models.Index(fields=['status', 'requested_at'], name='ix_pcr_status_requested'),
        ]
        ordering = ['-requested_at']

    def __str__(self) -> str:
        return f'PlanChangeRequest #{self.pk} entry={self.entry_id} {self.status}'

    @property
    def freeze_season(self):
        """Season anchor for the closed-season write freeze (`core.seasons.freeze_season_of`)."""
        return self.entry.season
