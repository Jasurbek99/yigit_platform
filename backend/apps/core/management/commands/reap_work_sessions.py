"""Close work sessions whose heartbeats have gone silent.

Run from host cron every 60 seconds:

    * * * * * /usr/bin/python /app/manage.py reap_work_sessions

Closes any `core.work_sessions` row where `ended_at IS NULL` and
`last_heartbeat_at` is older than `WS_IDLE_THRESHOLD_SECONDS` (default 120 s).
The `ended_at` is set to `last_heartbeat_at` so a session that silently died
at 14:32 isn't credited with the dead time up to the reaper run at 14:35.

In-process timers would race across uvicorn workers — cron is the
intentionally simple choice.
"""
from django.core.management.base import BaseCommand

from apps.core.services import worklog


class Command(BaseCommand):
    help = 'Close stale work_sessions whose heartbeat is older than the idle threshold.'

    def handle(self, *args, **options) -> None:
        closed = worklog.reap_stale()
        self.stdout.write(self.style.SUCCESS(f'reaped {closed} stale work_sessions'))
