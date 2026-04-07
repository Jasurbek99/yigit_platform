"""Management command: create block manager users and assign them to greenhouse blocks.

Source: Pomidor_Dükany__20252026.xlsx — "Hepdelik planlama" sheet, column A (Jogapkar).

Usage:
    python manage.py seed_block_managers           # create/update and assign
    python manage.py seed_block_managers --dry-run # show what would be created
"""
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import GreenhouseBlock, User
from apps.export.models import BlockManagerAssignment


# Block manager roster extracted from Hepdelik planlama sheet.
# username  : Django username (ASCII-safe, no special chars)
# first_name: as shown in Excel (Turkmen, may contain diacritics)
# last_name : initial only — full surnames not present in Excel
# phone     : from Excel Jogapkar cell
# password  : temporary default — must be changed on first login
# blocks    : primary block assignments
BLOCK_MANAGERS = [
    {
        'username': 'toyly_b',
        'first_name': 'Toyly',
        'last_name': 'B.',
        'phone': '+99361608737',
        'password': 'blockmanager123',
        'blocks': ['A', 'B', 'C'],
    },
    {
        'username': 'guwanc_k',
        'first_name': 'Guwanç',
        'last_name': 'K.',
        'phone': '+99363018382',
        'password': 'blockmanager123',
        'blocks': ['D', 'M15', 'M5'],
    },
    {
        'username': 'geldimyrat_a',
        'first_name': 'Geldimyrat',
        'last_name': 'A.',
        'phone': '+99365234059',
        'password': 'blockmanager123',
        'blocks': ['E', 'F'],
    },
    {
        'username': 'asdan_h',
        'first_name': 'Asdan',
        'last_name': 'H.',
        'phone': '+99362093301',
        'password': 'blockmanager123',
        'blocks': ['G', 'H'],
    },
    {
        'username': 'mekan_a',
        'first_name': 'Mekan',
        'last_name': 'A.',
        'phone': '+99363690069',
        'password': 'blockmanager123',
        'blocks': ['I', 'J'],
    },
    {
        'username': 'batyr_c',
        'first_name': 'Batyr',
        'last_name': 'Çaýtyýew',
        'phone': '+99362655224',
        'password': 'blockmanager123',
        'blocks': ['K', 'L'],
    },
    {
        'username': 'bayram_j',
        'first_name': 'Bayram',
        'last_name': 'J.',
        'phone': '+99364102042',
        'password': 'blockmanager123',
        'blocks': ['O'],
    },
    # Arazguly — substitute for Guwanç on D/M15/M5 (week 41 data).
    # Created as inactive substitute; director can activate if needed.
    {
        'username': 'arazguly',
        'first_name': 'Arazguly',
        'last_name': '',
        'phone': '+99361113776',
        'password': 'blockmanager123',
        'blocks': [],  # No permanent block assignment — substitute only
        'is_active': False,
    },
]


class Command(BaseCommand):
    help = 'Create block manager users and assign them to greenhouse blocks'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be created without writing to the database',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        block_map = {b.code: b for b in GreenhouseBlock.objects.all()}

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN -- no changes will be written\n'))
        missing_blocks = set()

        users_created = 0
        users_updated = 0
        assignments_created = 0

        for data in BLOCK_MANAGERS:
            username = data['username']
            is_active = data.get('is_active', True)

            user_defaults = {
                'first_name': data['first_name'],
                'last_name': data['last_name'],
                'role': 'greenhouse_manager',
                'phone': data['phone'],
                'is_staff': False,
                'is_superuser': False,
                'is_active': is_active,
            }

            if dry_run:
                exists = User.objects.filter(username=username).exists()
                status = 'exists' if exists else 'NEW'
                active_label = '' if is_active else ' [inactive/substitute]'
                self.stdout.write(
                    f'  User {username!r:20s} ({data["first_name"]} {data["last_name"]}) '
                    f'-> {status}{active_label}'
                )
                user = User.objects.filter(username=username).first()
            else:
                with transaction.atomic():
                    user, created = User.objects.get_or_create(
                        username=username,
                        defaults={**user_defaults, 'password': make_password(data['password'])},
                    )
                    if created:
                        users_created += 1
                    else:
                        # Update profile fields but never overwrite the password
                        for field, value in user_defaults.items():
                            setattr(user, field, value)
                        user.save(update_fields=list(user_defaults.keys()))
                        users_updated += 1

            for block_code in data['blocks']:
                block = block_map.get(block_code)
                if block is None:
                    missing_blocks.add(block_code)
                    self.stderr.write(
                        f'  WARNING: block code {block_code!r} not found — skipping assignment for {username}'
                    )
                    continue

                if dry_run:
                    already = (
                        user is not None
                        and BlockManagerAssignment.objects.filter(user=user, block=block).exists()
                    )
                    status = 'exists' if already else 'NEW'
                    self.stdout.write(f'    Assignment {username!r} -> block {block_code}: {status}')
                else:
                    _, created = BlockManagerAssignment.objects.get_or_create(
                        user=user,
                        block=block,
                        defaults={'is_active': True},
                    )
                    if created:
                        assignments_created += 1
                    # Also set the direct FK on the block so BlocksPage shows the manager
                    GreenhouseBlock.objects.filter(code=block_code, manager__isnull=True).update(manager=user)

        if not dry_run:
            self.stdout.write(
                self.style.SUCCESS(
                    f'\nDone.\n'
                    f'  Users created : {users_created}\n'
                    f'  Users updated : {users_updated}\n'
                    f'  Assignments   : {assignments_created} new\n'
                    f'  Skipped blocks: {sorted(missing_blocks) or "none"}\n'
                    f'\n  Default password: blockmanager123  (change before production!)'
                )
            )
