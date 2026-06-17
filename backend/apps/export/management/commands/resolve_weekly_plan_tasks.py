"""Management command: auto-resolve open weekly_plan Tasks.

Marks DONE any weekly_plan task whose plan week now has no blank cells for the
assignee's blocks. Resolution is normally lazy (on the /me/tasks/ read path);
this command exists for cron/backfill robustness if instant resolution is needed.

Usage:
    python manage.py resolve_weekly_plan_tasks
"""
from django.core.management.base import BaseCommand

from apps.export.services import resolve_all_open_weekly_plan_tasks


class Command(BaseCommand):
    help = 'Auto-resolve open weekly_plan tasks whose plan week is fully filled.'

    def handle(self, *args, **options):
        resolved = resolve_all_open_weekly_plan_tasks()
        self.stdout.write(self.style.SUCCESS(f'Resolved {len(resolved)} weekly_plan task(s).'))
