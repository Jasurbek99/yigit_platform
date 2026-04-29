"""Add code, is_experimental, scientific_name to TomatoVariety and seed 13 varieties."""

from django.db import migrations, models


# ---------------------------------------------------------------------------
# Seed data — 10 official + 3 experimental varieties
# ---------------------------------------------------------------------------
_VARIETIES = [
    # (code, name, type, is_experimental, scientific_name)
    ('01', 'Marvelans',   None,              False, ''),
    ('02', 'Midelice',    None,              False, ''),
    ('03', 'Sort-1',      'salkym/gulpakly', False, ''),
    ('04', 'Juanita',     None,              False, ''),
    ('05', 'MIX',         None,              False, ''),
    ('06', 'Fujimaro',    None,              False, ''),
    ('07', 'Defensiosa',  None,              False, 'DRTH0072'),
    ('08', 'Redity',      None,              False, 'DRTH1050'),
    ('09', 'Runtino',     None,              False, ''),
    ('10', 'Sort-2',      None,              False, ''),
    ('E1', 'Dakota',      None,              True,  ''),
    ('E2', 'Martinique',  None,              True,  ''),
    ('E3', 'Perimos',     None,              True,  ''),
]


def seed_varieties(apps, schema_editor):
    """Idempotent seed: update_or_create keyed on name."""
    TomatoVariety = apps.get_model('core', 'TomatoVariety')
    for code, name, variety_type, is_experimental, scientific_name in _VARIETIES:
        TomatoVariety.objects.update_or_create(
            name=name,
            defaults={
                'code': code,
                'is_experimental': is_experimental,
                'scientific_name': scientific_name,
                'type': variety_type,
            },
        )


def noop(apps, schema_editor):
    """Reverse is a no-op — we don't unseed variety data."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_customer_fk_on_delete_protect'),
    ]

    operations = [
        migrations.AddField(
            model_name='tomatovariety',
            name='code',
            field=models.CharField(blank=True, max_length=5, null=True, unique=True),
        ),
        migrations.AddField(
            model_name='tomatovariety',
            name='is_experimental',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='tomatovariety',
            name='scientific_name',
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.RunPython(seed_varieties, noop),
    ]
