"""Hide the cargo_code row from the Sheet body.

Reason:
  The Export Code (``cargo_code``) is already rendered at the top of every
  shipment column by ``SheetColumnHeader`` (frontend SheetGrid.tsx). The
  duplicate read-only row in the Sheet body adds no information.

Effect:
  Flips ``SheetRowSetting.is_visible`` from True → False for
  ``field_key='cargo_code'`` and records the transition in ``hidden_at`` so
  the /sheet/ endpoint excludes it from the payload for every user.

Reversible:
  Restores ``is_visible=True`` and clears ``hidden_at``. Admins can also
  flip it back at runtime through the SheetRowSetting admin once that UI
  exists.
"""

from django.db import migrations
from django.utils import timezone


_FIELD_KEY = 'cargo_code'


def _hide_cargo_code(apps, schema_editor):
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    row = SheetRowSetting.objects.filter(field_key=_FIELD_KEY).first()
    if row is None:
        return
    if not row.is_visible:
        return
    row.is_visible = False
    row.hidden_at = timezone.now()
    row.save(update_fields=['is_visible', 'hidden_at'])


def _show_cargo_code(apps, schema_editor):
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    row = SheetRowSetting.objects.filter(field_key=_FIELD_KEY).first()
    if row is None:
        return
    if row.is_visible:
        return
    row.is_visible = True
    row.hidden_at = None
    row.save(update_fields=['is_visible', 'hidden_at'])


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0015_add_sales_report_date'),
    ]

    operations = [
        migrations.RunPython(_hide_cargo_code, reverse_code=_show_cargo_code),
    ]
