"""Un-hide the cargo_code row in the Sheet body.

Reason:
  Migration 0016 hid the cargo_code row because the Export Code was shown
  in every column header by SheetColumnHeader. The header now displays the
  operator-entered ``official_export_code`` (Export Code) instead, so the
  platform-internal ``cargo_code`` ("Shipment Code") needs to be visible as
  a normal data row again.

Effect:
  Flips ``SheetRowSetting.is_visible`` from False → True for
  ``field_key='cargo_code'`` and clears ``hidden_at``.

Reversible:
  Restores ``is_visible=False`` and stamps ``hidden_at`` to now.
"""

from django.db import migrations
from django.utils import timezone


_FIELD_KEY = 'cargo_code'


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


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0026_add_transport_docs_given_at'),
    ]

    operations = [
        migrations.RunPython(_show_cargo_code, reverse_code=_hide_cargo_code),
    ]
