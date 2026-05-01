"""Seed ShipmentOptionType rows: 6 categories, 19 options total.

Re-emitted after the schema collapse refactor. Idempotent via the
(category, code) existence check. Skipped when DJANGO_TESTING=true so
test ``setUp`` methods that create their own option rows don't hit
UNIQUE conflicts.
"""
import os

from django.db import migrations


SEED_DATA = [
    # (category, code, label_tk, label_en, label_ru, icon, sort_order)
    # Vehicle condition
    ('vehicle_condition', 'OK', 'OK', 'OK', 'OK', None, 1),
    ('vehicle_condition', 'ISSUE', 'Mesele bar', 'Issue', 'Проблема', None, 2),
    ('vehicle_condition', 'BREAKDOWN', 'Döwüldi', 'Breakdown', 'Поломка', None, 3),
    ('vehicle_condition', 'RETURNED', 'Yzyna gaýtdy', 'Returned', 'Возврат', None, 4),
    # Customs clearance
    ('customs_clearance', 'approved', 'Tassyklandy', 'Approved', 'Одобрено', '✓', 1),
    ('customs_clearance', 'in_progress', 'Dowam edýär', 'In Progress', 'В процессе', '→', 2),
    ('customs_clearance', 'not_started', 'Başlanmady', 'Not Started', 'Не начато', '—', 3),
    # Documents status
    ('documents_status', 'ok', 'Taýýar', 'OK', 'Готово', 'OK', 1),
    ('documents_status', 'in_progress', 'Taýýarlanýar', 'In Progress', 'В процессе', '⏳', 2),
    ('documents_status', 'missing', 'Ýok', 'Missing', 'Отсутствует', '❌', 3),
    # Harvest status
    ('harvest_status', 'ok', 'Taýýar', 'Ok', 'Готово', None, 1),
    ('harvest_status', 'harvesting', 'Ýygylýar', 'Harvesting', 'Собирается', None, 2),
    ('harvest_status', 'not_ready', 'Taýýar däl', 'Not Ready', 'Не готово', None, 3),
    # Transport responsible
    ('transport_responsible', 'malik', 'Malik', 'Malik', 'Малик', None, 1),
    ('transport_responsible', 'haltac', 'Haltaç', 'Haltac', 'Халтач', None, 2),
    ('transport_responsible', 'gapy_satys', 'Gapy Satyş', 'Gapy Satys', 'Гапы Сатыш', None, 3),
    ('transport_responsible', 'serwi', 'Serwi', 'Serwi', 'Серви', None, 4),
    ('transport_responsible', 'gadam', 'Gadam', 'Gadam', 'Гадам', None, 5),
    ('transport_responsible', 'aganazar', 'Aganazar', 'Aganazar', 'Аганазар', None, 6),
]


def seed_shipment_option_types(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    ShipmentOptionType = apps.get_model('core', 'ShipmentOptionType')
    existing = set(ShipmentOptionType.objects.values_list('category', 'code'))
    records = [
        ShipmentOptionType(
            category=category,
            code=code,
            label_tk=label_tk,
            label_en=label_en,
            label_ru=label_ru,
            icon=icon,
            sort_order=sort_order,
            is_active=True,
        )
        for category, code, label_tk, label_en, label_ru, icon, sort_order in SEED_DATA
        if (category, code) not in existing
    ]
    if records:
        ShipmentOptionType.objects.bulk_create(records, batch_size=500)


def remove_shipment_option_types(apps, schema_editor):
    ShipmentOptionType = apps.get_model('core', 'ShipmentOptionType')
    categories = {row[0] for row in SEED_DATA}
    ShipmentOptionType.objects.filter(category__in=categories).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(
            seed_shipment_option_types,
            reverse_code=remove_shipment_option_types,
        ),
    ]
