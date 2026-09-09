"""Collapse the two look-alike `documents_status` options into one (F26).

The category shipped with `ok` (EN "OK" / RU "Готово" / TK "Taýýar", sort 1) and later
gained `ready` (EN/RU/TK all literally "OK", sort 40). The draft→gumruk_girish gate is
`TaskRule(completion_rule='field_equals', target_value='ready')`, so the option that
actually reads *Ready* to an operator is the one that does NOT satisfy the gate — a
shipment sits in `draft` with no feedback. See docs/SHEET_LIFECYCLE_E2E_2026-09-08.md.

`ready` is kept because it is the value the gate matches and 82 shipments already carry
it; repointing the TaskRule at `ok` instead would mean migrating those 82 rows. So we
move `ok`'s good labels onto `ready`, migrate the 3 stragglers, and retire `ok`.

`ok` is retired via `is_active=False`, not deleted: it is a historical value and other
categories (`harvest_status`, `vehicle_condition`) have their own unrelated `ok` rows,
so every query here is scoped by category.
"""

from django.db import migrations

CATEGORY = 'documents_status'

GOOD_LABELS = {
    'label_en': 'Ready',
    'label_ru': 'Готово',
    'label_tk': 'Taýýar',
    'icon': '✅',
    'sort_order': 1,
}


def collapse(apps, schema_editor):
    Option = apps.get_model('core', 'ShipmentOptionType')
    Shipment = apps.get_model('export', 'Shipment')

    ready = Option.objects.filter(category=CATEGORY, code='ready').first()
    if ready is None:
        # Environment never got the bolted-on row — nothing to collapse.
        return

    for field, value in GOOD_LABELS.items():
        setattr(ready, field, value)
    ready.is_active = True
    ready.save()

    # Anyone who picked the Turkmen-looking option meant "ready".
    Shipment.objects.filter(documents_status='ok').update(documents_status='ready')

    Option.objects.filter(category=CATEGORY, code='ok').update(is_active=False)


def restore(apps, schema_editor):
    """Re-expose `ok` and put `ready` back to its unlabelled state.

    Shipments are NOT moved back: `ready` is the value the gate matches, so returning
    them to `ok` would re-break the rows this migration fixed.
    """
    Option = apps.get_model('core', 'ShipmentOptionType')

    Option.objects.filter(category=CATEGORY, code='ok').update(is_active=True)
    Option.objects.filter(category=CATEGORY, code='ready').update(
        label_en='OK', label_ru='OK', label_tk='OK', icon=None, sort_order=40,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0040_fleet_resource'),
        ('export', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(collapse, restore),
    ]
