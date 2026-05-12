"""State machine v2 — restructure ShipmentStatusType for auto-advance.

Changes vs the original 13-step machine:
  - Reorders: yuklenme moves from step 1 to step 3 (after both customs steps).
    Customs paperwork is now pre-cleared while the truck loads at the
    greenhouse, matching operational reality.
  - Merges: serhet_tm + serhet_gechdi -> single serhet_gechdi
    ('Crossed TM Border'); hasabat + tamamlandy -> single tamamlandy
    ('Report received & Completed').
  - Adds: dest_entry (Destination Entry), transshipment (optional, only
    inserted into the chain when has_peregruz=True).
  - Renames: satyldy -> 'Sold (waiting for Report)'.
  - Retires: serhet_tm, yolda, hasabat (kept in DB for audit reference,
    excluded from new transitions via is_active=False).

Step_order is fully renumbered. Retired codes get high (100+) step_order
values so they sort last and never collide with active codes.

Idempotent via update_or_create / explicit filter().update().
Skipped when DJANGO_TESTING=true to keep test fixtures lean.

The companion shipment-row remap (serhet_tm -> serhet_gechdi etc.) lives
in export migration 0021_remap_retired_statuses, which depends on this
migration.
"""
import os

from django.db import migrations


# (code, step_order, name_tk, name_en, name_ru, required_role, phase, is_active)
NEW_AND_UPDATED_STATUSES = [
    # Active 12-step chain
    ('draft',           0,  'Garalama',           'Draft',                       'Черновик',                       'warehouse_chief', 'DRAFT',    True),
    ('gumruk_girish',   1,  'Gümrük girizilmesi', 'Customs Entry',               'Передача документов на таможню',  'document_team',   'CUSTOMS',  True),
    ('gumruk_chykysh',  2,  'Gümrükden çykyş',    'Customs Exit',                'Выход с таможни',                'document_team',   'CUSTOMS',  True),
    ('yuklenme',        3,  'Ýüklenme',           'Loading',                     'Погрузка',                       'warehouse_chief', 'LOADING',  True),
    ('yola_chykdy',     4,  'Ýola çykdy',         'Departed',                    'Отправлен',                      'document_team',   'TRANSIT',  True),
    ('serhet_gechdi',   5,  'Serhet geçdi',       'Crossed TM Border',           'Пересёк TM границу',             'transport',       'BORDER',   True),
    ('dest_entry',      6,  'Barýan ýurduna girdi','Destination Entry',          'Въезд в страну назначения',      'sales_rep',       'BORDER',   True),
    ('barysh_gumrugi',  7,  'Baryş gümrugi',      'Dest. Customs',               'Таможня назначения',             'sales_rep',       'BORDER',   True),
    ('transshipment',   8,  'Peregruz',           'Transshipment',               'Перегрузка',                     'sales_rep',       'SALES',    True),
    ('bardy',           9,  'Bardy',              'Arrived',                     'Прибыл',                         'sales_rep',       'SALES',    True),
    ('satylyar',       10,  'Satylýar',           'Selling',                     'Продаётся',                      'sales_rep',       'SALES',    True),
    ('satyldy',        11,  'Satyldy',            'Sold (waiting for Report)',   'Продано (ждёт отчёт)',           'sales_rep',       'SALES',    True),
    ('tamamlandy',     12,  'Tamamlandy',         'Report received & Completed', 'Отчёт получен и завершено',      'finansist',       'COMPLETE', True),

    # Retired codes — kept for audit reference, not in new transitions
    ('serhet_tm',     100,  'Serhetde',           'TM Border (retired)',         'На границе (устар.)',            None,              'BORDER',   False),
    ('yolda',         101,  'Ýolda',              'In Transit (retired)',        'В пути (устар.)',                None,              'TRANSIT',  False),
    ('hasabat',       102,  'Hasabat',            'Report (retired)',            'Отчёт (устар.)',                 None,              'COMPLETE', False),
]


def apply_state_machine_v2(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    ShipmentStatusType = apps.get_model('core', 'ShipmentStatusType')
    for (code, step_order, name_tk, name_en, name_ru,
         required_role, phase, is_active) in NEW_AND_UPDATED_STATUSES:
        ShipmentStatusType.objects.update_or_create(
            code=code,
            defaults={
                'step_order':    step_order,
                'name_tk':       name_tk,
                'name_en':       name_en,
                'name_ru':       name_ru,
                'required_role': required_role,
                'phase':         phase,
                'is_active':     is_active,
            },
        )


def revert_state_machine_v2(apps, schema_editor):
    """Best-effort reverse: restore the pre-v2 13-step machine.

    Deletes dest_entry and transshipment (added in this migration), then
    restores original step_order / names / is_active=True on the rest.
    Not perfectly faithful (Cyrillic labels approximate) but enough to
    keep dev rollbacks usable.
    """
    ShipmentStatusType = apps.get_model('core', 'ShipmentStatusType')
    ShipmentStatusType.objects.filter(code__in=['dest_entry', 'transshipment']).delete()

    original = [
        ('draft',           0,  'Garalama',     'Draft',         'Черновик',         'warehouse_chief', 'DRAFT'),
        ('yuklenme',        1,  'Ýüklenme',     'Loading',       'Погрузка',         'warehouse_chief', 'LOADING'),
        ('gumruk_girish',   2,  'Gümrük girizilmesi','Customs Entry','Передача документов на таможню','document_team','CUSTOMS'),
        ('gumruk_chykysh',  3,  'Gümrükden çykyş','Customs Exit', 'Выход с таможни',  'document_team',   'CUSTOMS'),
        ('yola_chykdy',     4,  'Ýola çykdy',   'Departed',      'Отправлен',        'document_team',   'TRANSIT'),
        ('serhet_tm',       5,  'Serhetde',     'TM Border',     'На границе',       'transport',       'BORDER'),
        ('serhet_gechdi',   6,  'Serhet geçdi', 'Border Crossed','Пересёк границу',  'transport',       'BORDER'),
        ('barysh_gumrugi',  7,  'Baryş gümrugi','Dest Customs',  'Таможня назначения','sales_rep',      'BORDER'),
        ('yolda',           8,  'Ýolda',        'In Transit',    'В пути',           'sales_rep',       'TRANSIT'),
        ('bardy',           9,  'Bardy',        'Arrived',       'Прибыл',           'sales_rep',       'SALES'),
        ('satylyar',       10,  'Satylýar',     'Being Sold',    'Продаётся',        'sales_rep',       'SALES'),
        ('satyldy',        11,  'Satyldy',      'Sold',          'Продано',          'sales_rep',       'SALES'),
        ('hasabat',        12,  'Hasabat',      'Report',        'Отчёт',            'sales_rep',       'COMPLETE'),
        ('tamamlandy',     13,  'Tamamlandy',   'Completed',     'Завершено',        'finansist',       'COMPLETE'),
    ]
    for (code, step_order, name_tk, name_en, name_ru, required_role, phase) in original:
        ShipmentStatusType.objects.filter(code=code).update(
            step_order=step_order,
            name_tk=name_tk,
            name_en=name_en,
            name_ru=name_ru,
            required_role=required_role,
            phase=phase,
            is_active=True,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_add_status_type_is_active'),
    ]

    operations = [
        migrations.RunPython(
            apply_state_machine_v2,
            reverse_code=revert_state_machine_v2,
        ),
    ]
