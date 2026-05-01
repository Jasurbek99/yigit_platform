"""Add code, is_experimental, scientific_name to TomatoVariety and seed 13 varieties.

Manually rewritten from AddField → RunSQL because mssql-django's schema editor
builds an incorrect query against sys.default_constraints when adding a NOT NULL
column with default to a table in a non-dbo schema (e.g. [core].[tomato_varieties]).
The query searches t.name = '[core].[tomato_varieties]' (with brackets) but
sys.tables stores just 'tomato_varieties'. The fallback then tries to drop a
constraint named after the column itself, which fails.

The 3-step pattern (ADD as NULL → UPDATE → ALTER to NOT NULL) sidesteps the
buggy default-constraint cleanup path. Same pattern as 0002_add_is_gapy_satys_to_firms.

For nullable string columns (code, scientific_name) the bug doesn't apply —
those are kept as native AddField operations.
"""

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
        # Nullable columns — safe via native AddField
        migrations.AddField(
            model_name='tomatovariety',
            name='code',
            field=models.CharField(blank=True, max_length=5, null=True, unique=True),
        ),
        migrations.AddField(
            model_name='tomatovariety',
            name='scientific_name',
            field=models.CharField(blank=True, max_length=50),
        ),
        # NOT NULL boolean with default — must use RunSQL workaround
        migrations.RunSQL(
            sql=[
                "ALTER TABLE [core].[tomato_varieties] ADD [is_experimental] bit NULL;",
                "UPDATE [core].[tomato_varieties] SET [is_experimental] = 0 WHERE [is_experimental] IS NULL;",
                "ALTER TABLE [core].[tomato_varieties] ALTER COLUMN [is_experimental] bit NOT NULL;",
            ],
            reverse_sql=[
                "ALTER TABLE [core].[tomato_varieties] DROP COLUMN [is_experimental];",
            ],
            state_operations=[
                migrations.AddField(
                    model_name='tomatovariety',
                    name='is_experimental',
                    field=models.BooleanField(default=False),
                ),
            ],
        ),
        # Seed data after schema is ready
        migrations.RunPython(seed_varieties, noop),
    ]