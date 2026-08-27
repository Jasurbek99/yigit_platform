from django.db import models
from apps.core.db_utils import schema_table


LOCAL_SELL_STATUS_CHOICES = [
    ('draft', 'Draft'),
    ('submitted', 'Submitted'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]

LOCAL_SELL_TRANSITIONS = {
    'draft': ['submitted'],
    'submitted': ['approved', 'rejected'],
    'rejected': ['submitted'],
    'approved': [],
}

#: The six writable day columns, in week order. Kept next to the transitions
#: because the lock rule below is defined over exactly this set.
LOCAL_SELL_DAY_FIELDS = (
    'monday_plan_kg', 'tuesday_plan_kg', 'wednesday_plan_kg',
    'thursday_plan_kg', 'friday_plan_kg', 'saturday_plan_kg',
)


class WeeklyLocalSellPlan(models.Model):
    """Weekly domestic sell plan per export firm.

    One row per (export_firm, week_number, year). Plan vs actual for Mon–Sat.
    Includes approval workflow: draft → submitted → approved / rejected.

    DDL: export.weekly_local_sell_plans — UNIQUE (export_firm_id, week_number, year)
    """

    # === Identity ===
    export_firm = models.ForeignKey(
        'core.ExportFirm', on_delete=models.PROTECT,
        db_column='export_firm_id', related_name='local_sell_plans',
    )
    week_number = models.PositiveSmallIntegerField()  # ISO week 1-53
    year = models.PositiveSmallIntegerField()
    season = models.ForeignKey(
        'core.Season', on_delete=models.PROTECT,
        db_column='season_id', null=True, blank=True,
    )

    # === Plan (kg) ===
    monday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tuesday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    wednesday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    thursday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    friday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    saturday_plan_kg = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    # === Approval workflow ===
    status = models.CharField(max_length=20, choices=LOCAL_SELL_STATUS_CHOICES, default='draft')
    submitted_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='submitted_by', related_name='local_sell_plans_submitted',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='approved_by', related_name='local_sell_plans_approved',
    )
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejected_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='rejected_by', related_name='local_sell_plans_rejected',
    )
    rejection_note = models.CharField(max_length=500, blank=True, null=True)

    # === Audit ===
    entered_by = models.ForeignKey(
        'core.User', on_delete=models.SET_NULL, null=True, blank=True,
        db_column='entered_by', related_name='local_sell_plans_entered',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = schema_table('export', 'weekly_local_sell_plans')
        indexes = [
            models.Index(fields=['status'], name='ix_local_sell_plan_status'),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['export_firm', 'week_number', 'year'],
                name='uq_local_sell_plan',
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
                name='chk_local_sell_plan_kg_gte0',
            ),
        ]
        ordering = ['year', 'week_number', 'export_firm__name_en']

    def __str__(self) -> str:
        firm = getattr(self.export_firm, 'name_en', None) or f'firm#{self.export_firm_id}'
        return f'W{self.week_number}/{self.year} — {firm} [{self.status}]'

    # === Edit lock ===

    def locked_day_fields(self, *, is_approver: bool) -> tuple[str, ...]:
        """Day columns that may NOT be written right now.

        The grid autosaves every cell and auto-submits the week on the first
        non-zero save, so "may I edit this?" is a per-cell question, not a
        per-row one:

        * ``approved`` — every day is locked, for everyone, approvers and admin
          included. ``LOCAL_SELL_TRANSITIONS['approved'] == []`` already made
          the status terminal; this closes the last way back in (a plain PATCH).
        * ``submitted`` — a writer may still fill days that are still EMPTY,
          but not change one that already holds a value. An approver keeps the
          existing override path and gets nothing locked.
        * ``draft`` / ``rejected`` — nothing is locked.

        EMPTY means ``0``, not NULL: the six columns are ``default=0`` NOT NULL
        (there is no way to express "not filled in" other than 0), and two
        existing consumers already read them that way —
        ``services/shipment.submit_local_sell_plan`` requires ``> 0`` on at
        least one day, and ``services/local_sell_plan_tasks._week_is_complete``
        treats an all-``0`` draft as "nothing to sell".

        Args:
            is_approver: True for LOCAL_SELL_APPROVE roles
                (admin / export_manager / director).

        Returns:
            The locked field names, a subset of LOCAL_SELL_DAY_FIELDS.
        """
        if self.status == 'approved':
            return LOCAL_SELL_DAY_FIELDS
        if self.status == 'submitted' and not is_approver:
            return tuple(f for f in LOCAL_SELL_DAY_FIELDS if getattr(self, f) > 0)
        return ()
