"""Operating day exception calendar for the greenhouse dispatcher."""
from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table


class OperatingDayException(models.Model):
    """Override an individual calendar date as a holiday or extra working day.

    The dispatcher checks this table before firing time-based notifications.
    When `is_holiday=True`, the date is skipped even if the operating_days_bitmask
    would normally allow it. (Future: is_holiday=False would mark a normally-off day
    as working, but the dispatcher doesn't use that path yet.)

    DDL: core.operating_day_exceptions
    UNIQUE: date
    """

    date = models.DateField(unique=True)
    is_holiday = models.BooleanField(
        default=True,
        help_text='True = treat this date as non-operating (skip notifications).',
    )
    note = models.CharField(
        max_length=200,
        blank=True,
        default='',
        **cyrillic_collation(),
    )

    # === Audit ===
    created_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column='created_by',
        related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('core', 'operating_day_exceptions')
        ordering = ['date']

    def __str__(self) -> str:
        kind = 'holiday' if self.is_holiday else 'extra-working'
        return f'{self.date} ({kind})'
