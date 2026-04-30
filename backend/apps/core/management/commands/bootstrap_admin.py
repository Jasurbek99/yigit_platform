"""Promote all is_superuser users to role='admin'.

Idempotent. Safe to run on every deploy, on a fresh CI/staging environment,
during developer onboarding, and after restoring from an older backup.

Replaces the `manage.py shell -c "..."` one-liner that previously sufficed
when 'admin' did not exist as a role choice. See AD-15.
"""
from django.core.management.base import BaseCommand

from apps.core.models import User


class Command(BaseCommand):
    help = "Promote every is_superuser user to role='admin'. Idempotent."

    def handle(self, *args, **options):
        qs = User.objects.filter(is_superuser=True).exclude(role='admin')
        names = list(qs.values_list('username', flat=True))
        n = qs.update(role='admin')
        if n:
            self.stdout.write(self.style.SUCCESS(
                f'Promoted {n} superuser(s) to admin: {", ".join(names)}'
            ))
        else:
            self.stdout.write('No superusers needed promotion.')
