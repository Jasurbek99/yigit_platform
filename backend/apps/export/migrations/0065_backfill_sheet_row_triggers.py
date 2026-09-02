"""Run the AD-17 trigger backfill so no role loses write access.

See apps/export/management/commands/backfill_sheet_row_triggers.py for the
rules. Skipped under DJANGO_TESTING like the other permission data migrations —
tests call backfill() directly against seeded data.
"""
import os

from django.db import migrations


def run_backfill(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    from apps.export.management.commands.backfill_sheet_row_triggers import backfill
    backfill()


def noop_reverse(apps, schema_editor):
    """Not reversed: we cannot tell a backfilled trigger from a hand-made one."""


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0064_sheetcellcolor'),
    ]

    operations = [
        migrations.RunPython(run_backfill, reverse_code=noop_reverse),
    ]
