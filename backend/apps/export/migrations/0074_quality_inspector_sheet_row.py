"""Hand Sheet row 26 (transit days + temperature) from transport to
``quality_inspector``.

Field permissions alone do not open a Sheet cell. A locked row is gated by its
``SheetRowRoleTrigger`` rows as well, so moving `transit_days` /
`transport_temp_c` onto the new role in core/0054 without moving the trigger
would leave the inspector with a grant he cannot exercise — and would leave
transport holding a trigger for a field it can no longer edit.

``transit_days_temp`` is a virtual field_key: the frontend renders it as
"${days}d ${temp}°C" and PATCHes both real fields at once, and
``can_edit_sheet_field`` delegates its permission check to the real
`transit_days` field. So this one row is the whole Sheet surface for the move.

``role_group`` is set too — it is purely cosmetic (which labelled band the row
renders in) but leaving it on 'transport' would file the inspector's only row
under someone else's heading.

The row's stored ``who_tk`` / ``who_ru`` / ``who_en`` are rewritten as well.
Those columns are a per-row override that ``backfill_sheet_row_defaults`` froze
from the i18n key at seed time; the Sheet's "Who" column prefers them over
``default_who_key``, so changing the key in ``sheet_rows.py`` alone would leave
the live row still captioned "Transport böl." under a quality-inspector band.
The three strings are snapshotted from ``sheet.who.quality`` in the frontend
i18n bundle — a migration must not read frontend files at apply time. Only rows
still holding the transport caption are touched, so a caption an admin has since
edited by hand is left alone.

Idempotent and reversible.
"""
import os

from django.db import migrations

FIELD_KEY = 'transit_days_temp'
OLD_ROLE = 'transport'
NEW_ROLE = 'quality_inspector'

# Snapshot of `sheet.who.transport` / `sheet.who.quality` (frontend i18n,
# 2026-09-22), keyed by column.
WHO_CAPTIONS = {
    'who_tk': ('Transport böl.', 'Hil gözegçi'),
    'who_ru': ('Транспорт', 'Контроль кач.'),
    'who_en': ('Transport', 'Quality Insp.'),
}


def move_row_to_inspector(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    _swap_role(apps, OLD_ROLE, NEW_ROLE)


def move_row_back_to_transport(apps, schema_editor):
    _swap_role(apps, NEW_ROLE, OLD_ROLE)


def _swap_role(apps, from_role, to_role):
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    SheetRowRoleTrigger = apps.get_model('export', 'SheetRowRoleTrigger')

    for row in SheetRowSetting.objects.filter(field_key=FIELD_KEY):
        SheetRowRoleTrigger.objects.get_or_create(row=row, role=to_role)
        SheetRowRoleTrigger.objects.filter(row=row, role=from_role).delete()

        dirty = []

        if row.role_group == from_role:
            row.role_group = to_role
            dirty.append('role_group')

        # WHO_CAPTIONS maps column -> (transport caption, quality caption);
        # pick the direction from which role we are moving to.
        for column, (transport_caption, quality_caption) in WHO_CAPTIONS.items():
            expected, replacement = (
                (transport_caption, quality_caption)
                if to_role == NEW_ROLE
                else (quality_caption, transport_caption)
            )
            if getattr(row, column) == expected:
                setattr(row, column, replacement)
                dirty.append(column)

        if dirty:
            row.save(update_fields=dirty)


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0073_add_quality_inspector_role'),
        # The role must be a valid choice before rows may name it.
        ('core', '0053_add_quality_inspector_role'),
    ]

    operations = [
        migrations.RunPython(move_row_to_inspector, reverse_code=move_row_back_to_transport),
    ]
