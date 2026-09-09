"""Fill blank Sheet row labels and fix the Soltanmyrat typo (F27 / F32).

Three rows render with an empty column-3 label, so operators see a blank cell where the
field name should be: `firm_contracts` (blank in all three languages), `packing` (blank
label AND blank owner), and `rejected_weight_kg` (blank EN, TK is set).
Separately, `who` on `rejected_weight_kg` and `departed_at` reads "Soltanmyra**d**"
where every other row of that owner reads "Soltanmyra**t**".
See docs/SHEET_LIFECYCLE_E2E_2026-09-08.md.

Only blank values are written. SheetRowSetting is operator-editable config, so a
deliberate label typed in the admin on another environment must never be clobbered by
this migration — hence the `if not getattr(row, field)` guard on every label write.
The typo fix is an exact-match replace for the same reason.

NOT changed here, because they are business decisions rather than defects:
  - `firm_contracts.who` is "Shohrat" while the spec says Gadam.
  - `departed_at.who` is Soltanmyrat while the spec says transport (Mergen) and the
    TaskRule says document_team.
"""

from django.db import migrations

# field_key -> {model field: value to use when the current value is blank}
BLANK_FILLS = {
    'firm_contracts': {
        'label_en': 'Contracts',
        'label_ru': 'Договоры',
        'label_tk': 'Şertnamalar',
    },
    'packing': {
        'label_en': 'Packing (gross-net)',
        'label_ru': 'Упаковка (брутто-нетто)',
        'label_tk': 'Gaplama (brut-net)',
        # Row sits in the EXPORT MANAGER band, same owner as the other rows there.
        'who_en': 'Gadam J',
        'who_ru': 'Gadam J',
        'who_tk': 'Gadam J',
    },
    'rejected_weight_kg': {
        # label_tk is deliberately left alone: it reads "Ýüküň agramy" (cargo weight)
        # where the spec says "Ýüklemeli tonna" (tonnage to load). That is a wording
        # decision for the operators, not a blank to fill.
        'label_en': 'Weight to load',
        'label_ru': 'Вес к погрузке',
    },
}

TYPO_ROWS = ('rejected_weight_kg', 'departed_at')
TYPO_OLD = 'Soltanmyrad'
TYPO_NEW = 'Soltanmyrat'
WHO_FIELDS = ('who_en', 'who_ru', 'who_tk')


def fill(apps, schema_editor):
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')

    for field_key, values in BLANK_FILLS.items():
        row = SheetRowSetting.objects.filter(field_key=field_key).first()
        if row is None:
            continue
        changed = []
        for field, value in values.items():
            if not getattr(row, field):
                setattr(row, field, value)
                changed.append(field)
        if changed:
            row.save(update_fields=changed)

    for field_key in TYPO_ROWS:
        row = SheetRowSetting.objects.filter(field_key=field_key).first()
        if row is None:
            continue
        changed = [f for f in WHO_FIELDS if getattr(row, f) == TYPO_OLD]
        for field in changed:
            setattr(row, field, TYPO_NEW)
        if changed:
            row.save(update_fields=changed)


def unfill(apps, schema_editor):
    """Blank the labels this migration wrote and restore the typo.

    Only values still equal to what `fill` wrote are reverted, so an operator edit made
    after this migration ran survives the rollback.
    """
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')

    for field_key, values in BLANK_FILLS.items():
        row = SheetRowSetting.objects.filter(field_key=field_key).first()
        if row is None:
            continue
        changed = [f for f, v in values.items() if getattr(row, f) == v]
        for field in changed:
            setattr(row, field, '')
        if changed:
            row.save(update_fields=changed)

    for field_key in TYPO_ROWS:
        row = SheetRowSetting.objects.filter(field_key=field_key).first()
        if row is None:
            continue
        changed = [f for f in WHO_FIELDS if getattr(row, f) == TYPO_NEW]
        for field in changed:
            setattr(row, field, TYPO_OLD)
        if changed:
            row.save(update_fields=changed)


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0065_backfill_sheet_row_triggers'),
    ]

    operations = [
        migrations.RunPython(fill, unfill),
    ]
