"""Add SheetRowSetting.hidden_at — separates the hide-cooldown clock from updated_at.

Phase 1 reviewer note #5: the 30-day soft-delete cooldown read from
``updated_at``, which any cosmetic edit (label rename, style change) reset.
``hidden_at`` is now set only when ``is_visible`` flips True → False (cleared
on the reverse transition), so the cooldown reflects the real "hidden since"
moment. The transition is wired in ``SheetRowSetting.save()``.

Data step: for every existing row already at ``is_visible=False``, backfill
``hidden_at = updated_at`` so we don't accidentally bump the clock for rows
the admin had already hidden under the old logic.
"""
from django.db import migrations, models


def backfill_hidden_at(apps, schema_editor):
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    qs = SheetRowSetting.objects.filter(is_visible=False, hidden_at__isnull=True)
    rows = list(qs.only('id', 'updated_at', 'hidden_at'))
    if not rows:
        print('\n  [0003] No is_visible=False rows to backfill hidden_at on.')
        return
    for row in rows:
        row.hidden_at = row.updated_at
    SheetRowSetting.objects.bulk_update(rows, ['hidden_at'], batch_size=500)
    print(f'\n  [0003] Backfilled hidden_at on {len(rows)} previously-hidden rows.')


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0002_seed_truck_split_defaults'),
    ]

    operations = [
        migrations.AddField(
            model_name='sheetrowsetting',
            name='hidden_at',
            field=models.DateTimeField(
                blank=True,
                db_index=True,
                null=True,
                help_text='Timestamp of the most recent is_visible=False transition. '
                          'Null when is_visible=True (or never hidden).',
            ),
        ),
        migrations.RunPython(
            backfill_hidden_at,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
