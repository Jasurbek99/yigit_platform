import logging

from django.db import models

from apps.core.db_utils import cyrillic_collation, schema_table

logger = logging.getLogger(__name__)


class Notification(models.Model):
    """Per-user notification record.

    Created by services when quota thresholds are crossed or shipments become
    overdue. The KIND_CHOICES drive the frontend icon and copy.
    Marked read via NotificationViewSet.read / read_all actions.

    DDL: export_notifications
    """

    KIND_CHOICES = [
        ('quota_80', 'Quota 80%'),
        ('quota_90', 'Quota 90%'),
        ('quota_95', 'Quota 95%'),
        ('quota_100', 'Quota 100%'),
        ('overdue', 'Overdue shipment'),
        ('action_required', 'Action required'),
        ('plan_submitted', 'Plan submitted'),
        ('plan_approved', 'Plan approved'),
        ('plan_rejected', 'Plan rejected'),
    ]

    # === Target ===
    user = models.ForeignKey(
        'core.User',
        on_delete=models.CASCADE,
        db_column='user_id',
        related_name='notifications',
    )

    # === Content ===
    kind = models.CharField(max_length=30, choices=KIND_CHOICES)
    message = models.CharField(max_length=500, **cyrillic_collation())
    link = models.CharField(max_length=200, blank=True, null=True)

    # === Read state ===
    read_at = models.DateTimeField(null=True, blank=True)

    # === Audit ===
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('export', 'notifications')
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'[{self.kind}] → user={self.user_id} read={self.read_at is not None}'

    @property
    def is_read(self) -> bool:
        """True if the notification has been acknowledged by the user."""
        return self.read_at is not None
