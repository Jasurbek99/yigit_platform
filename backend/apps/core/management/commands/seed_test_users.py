"""Create one disposable test login per role that has no usable password.

Idempotent: existing users are left completely alone (no password reset, no role
change). Only creates usernames prefixed `t_`, so it can never touch a real
staff account. Safe to re-run on any environment.

    python manage.py seed_test_users            # create
    python manage.py seed_test_users --dry-run  # show what would happen
    python manage.py seed_test_users --delete   # remove every t_* account
"""
from django.core.management.base import BaseCommand

from apps.core.models import User

PASSWORD = 'Test1234!'

# Roles with no known-password login as of 2026-08-22. See docs/TEST_ACCOUNTS.md.
ROLES = [
    'accountant',
    # export_manager: the seeded `export_manager` account's documented password
    # `em123` does NOT match its hash (verified 2026-08-22), so the role had no
    # usable login either.
    'export_manager',
    'boss',
    'director',
    'document_team',
    'finansist',
    'greenhouse_manager',
    'loading_dept_head',
    'loading_dept_head_deputy',
    'seller',
    'weight_master',
]


class Command(BaseCommand):
    help = 'Create a t_<role> test login for each role lacking one. Idempotent.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--delete', action='store_true',
                            help='Delete every t_* account instead of creating.')

    def handle(self, *args, **options):
        if options['delete']:
            return self._delete(options['dry_run'])

        for role in ROLES:
            username = f't_{role}'
            if User.objects.filter(username=username).exists():
                self.stdout.write(f'  exists   {username}')
                continue
            if options['dry_run']:
                self.stdout.write(f'  WOULD CREATE {username} ({role})')
                continue
            user = User(
                username=username,
                role=role,
                first_name='Test',
                last_name=role.replace('_', ' ').title(),
                is_active=True,
            )
            user.set_password(PASSWORD)
            user.save()
            self.stdout.write(self.style.SUCCESS(f'  created  {username} ({role})'))

        self.stdout.write(f'\nPassword for all: {PASSWORD}')

    def _delete(self, dry_run):
        qs = User.objects.filter(username__startswith='t_')
        names = list(qs.values_list('username', flat=True))
        if dry_run:
            self.stdout.write(f'WOULD DELETE {len(names)}: {", ".join(names)}')
            return
        qs.delete()
        self.stdout.write(self.style.WARNING(f'Deleted {len(names)}: {", ".join(names)}'))
