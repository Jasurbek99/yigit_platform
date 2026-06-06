"""Per-WebSocket-connection work sessions.

One row per browser-tab WS connect lifetime. `active_seconds` accumulates a
capped delta each heartbeat — see `apps/core/services/worklog.py`. The
companion `WorkSessionDaily` model is `managed=False` and reads a SQL view
that sums per user per day.

Visibility rule (locked decision): every authenticated user can see every
other user's hours. No admin gate.
"""
from django.db import models

from apps.core.db_utils import schema_table


class WorkSession(models.Model):
    """A single WS connection's work-time window."""

    user = models.ForeignKey(
        'core.User',
        on_delete=models.CASCADE,
        db_column='user_id',
        related_name='work_sessions',
    )

    started_at = models.DateTimeField()
    last_heartbeat_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)

    active_seconds = models.IntegerField(default=0)
    last_state = models.CharField(max_length=10, default='active')

    # Client-generated UUID — survives reconnects within the same tab.
    tab_session_id = models.CharField(max_length=40, blank=True, default='')
    client_info = models.CharField(max_length=300, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = schema_table('core', 'work_sessions')
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['user', '-started_at']),
            # The reaper queries `ended_at IS NULL AND last_heartbeat_at < cutoff`
            # — supporting index keeps it fast even after months of rows.
            models.Index(fields=['ended_at', 'last_heartbeat_at']),
        ]

    def __str__(self) -> str:
        end = self.ended_at.isoformat() if self.ended_at else 'open'
        return f'WorkSession(user={self.user_id} {self.started_at.isoformat()} → {end})'


class WorkSessionDaily(models.Model):
    """Read-only view: per-user-per-day summed active seconds.

    Backed by the SQL view `core_work_session_daily` created in the migration
    via RunSQL. `managed = False` — Django neither creates nor drops it.
    """

    # The view has no real PK; Django requires one, so we synthesise a composite
    # via a string key in the SELECT. See migration.
    id = models.CharField(max_length=80, primary_key=True)
    user = models.ForeignKey(
        'core.User',
        on_delete=models.DO_NOTHING,
        db_column='user_id',
        related_name='+',
    )
    work_date = models.DateField()
    active_seconds_total = models.IntegerField()
    first_seen = models.DateTimeField()
    last_seen = models.DateTimeField()

    class Meta:
        managed = False
        db_table = schema_table('core', 'work_session_daily')
