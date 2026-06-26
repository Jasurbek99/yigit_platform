"""Clear the persisted ``rejected_weight_kg`` sheet-row labels so the Sheet
defers to the corrected i18n fallback ("weight to load" / "Ýüklemeli tonna").

The DB column / field_key stays ``rejected_weight_kg`` (legacy name), but it
actually holds the unofficial tonnage that must be loaded. It was mislabelled
as "rejected weight". The i18n strings are fixed in the same change.

The Sheet renders ``SheetRowSetting.label_{tk,ru,en}`` when present and only
falls back to the i18n ``label_key`` when they are blank (frontend:
``dbLabel ?? t(label_key)``). Some environments seeded these columns with the
old "received/rejected" strings — and one had an admin override that set all
three languages to a Turkmen-only spelling. Either way the persisted label now
diverges from (or de-localizes) the corrected i18n, so this migration **blanks
all three** for this single row, making the (now properly localized per-language)
i18n the single source of truth on the Sheet too.

Reverse restores the original pre-fix Sheet labels.
"""

from django.db import migrations

FIELD_KEY = 'rejected_weight_kg'

# Original (pre-fix) Sheet labels, restored on reverse.
ORIGINAL = {'label_tk': 'Arassa agramy (r)', 'label_ru': 'Вес нетто (получ.)', 'label_en': 'Net Weight (received)'}


def forwards(apps, schema_editor):
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    SheetRowSetting.objects.filter(field_key=FIELD_KEY).update(label_tk='', label_ru='', label_en='')


def backwards(apps, schema_editor):
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    SheetRowSetting.objects.filter(field_key=FIELD_KEY).update(**ORIGINAL)


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0046_drop_sales_rep_coverage'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
