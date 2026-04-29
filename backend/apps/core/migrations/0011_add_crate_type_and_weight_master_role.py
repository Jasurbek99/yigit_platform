"""Add weight_master role to User.role choices and create CrateType model.

Includes a RunPython step that seeds the three initial crate types:
- LEBIZ PLAST 18: 0.543 kg (verified from 10AP116_CEKIM_GAPAN.xlsx)
- AGAÇ: 2.000 kg (placeholder, is_active=False — pending Soltanmyrat confirmation)
- PLASMAS: 0.700 kg (placeholder, is_active=False — pending Soltanmyrat confirmation)
"""

from django.db import migrations, models


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

_CRATE_TYPES = [
    # (name, weight_kg, is_active)
    ('LEBIZ PLAST 18', '0.543', True),
    ('AGAÇ',           '2.000', False),   # weight TBD — ask Soltanmyrat
    ('PLASMAS',        '0.700', False),   # weight TBD — ask Soltanmyrat
]


def seed_crate_types(apps, schema_editor):
    """Idempotent seed: update_or_create keyed on name."""
    CrateType = apps.get_model('core', 'CrateType')
    for name, weight_kg, is_active in _CRATE_TYPES:
        CrateType.objects.update_or_create(
            name=name,
            defaults={'weight_kg': weight_kg, 'is_active': is_active},
        )


def reverse_crate_types(apps, schema_editor):
    """Remove the seeded rows on rollback."""
    CrateType = apps.get_model('core', 'CrateType')
    names = [row[0] for row in _CRATE_TYPES]
    CrateType.objects.filter(name__in=names).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0010_add_variety_codes_and_seed'),
    ]

    operations = [
        # 1. Add weight_master to User.role choices.
        #    Django requires an AlterField when choices change so the migration
        #    state matches the model — even though MSSQL doesn't enforce choices
        #    at the DB level, Django's migration framework validates against state.
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(
                choices=[
                    ('export_manager', 'Export Manager'),
                    ('warehouse_chief', 'Warehouse Chief'),
                    ('weight_master', 'Weight Master'),
                    ('document_team', 'Document Team'),
                    ('transport', 'Transport'),
                    ('sales_rep', 'Sales Rep'),
                    ('finansist', 'Finansist'),
                    ('director', 'Director'),
                    ('accountant', 'Accountant'),
                    ('greenhouse_manager', 'Greenhouse Manager'),
                    ('seller', 'Seller'),
                ],
                default='export_manager',
                max_length=30,
            ),
        ),

        # 2. Create the CrateType model.
        migrations.CreateModel(
            name='CrateType',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=30, unique=True)),
                ('weight_kg', models.DecimalField(decimal_places=3, max_digits=6)),
                ('is_active', models.BooleanField(default=True)),
            ],
            options={
                'ordering': ['name'],
                'db_table': '[core].[crate_types]',
            },
        ),

        # 3. Seed initial crate types.
        migrations.RunPython(seed_crate_types, reverse_crate_types),
    ]
