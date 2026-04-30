# Migration 0032 — SheetRowRoleTrigger child table (ADR-0009)
#
# Operation order is load-bearing (advisor note):
#   1. CreateModel SheetRowRoleTrigger
#   2. RunPython: migrate triggered_role values → SheetRowRoleTrigger rows
#   3. RemoveConstraint sheet_row_setting_role_xor_user
#      (MUST precede RemoveField — constraint references triggered_role column)
#   4. RemoveField triggered_role
#
# The data step and constraint/field removal are in the same migration (atomic).

import django.db.models.deletion
from django.db import migrations, models


def migrate_role_triggers(apps, schema_editor):
    """Copy existing triggered_role values to SheetRowRoleTrigger rows."""
    SheetRowSetting = apps.get_model('export', 'SheetRowSetting')
    SheetRowRoleTrigger = apps.get_model('export', 'SheetRowRoleTrigger')

    rows_with_role = list(
        SheetRowSetting.objects.filter(triggered_role__gt='').only('id', 'triggered_role')
    )
    if not rows_with_role:
        print('\n  [0032] No triggered_role values to migrate.')
        return

    trigger_rows = [
        SheetRowRoleTrigger(row_id=s.id, role=s.triggered_role)
        for s in rows_with_role
    ]
    # MSSQL does not support ignore_conflicts. The data step runs once during
    # forward migration; duplicates can't exist here because we're migrating
    # from a single triggered_role column with unique field_key.
    SheetRowRoleTrigger.objects.bulk_create(trigger_rows, batch_size=500)
    print(
        f'\n  [0032] Migrated {len(trigger_rows)} triggered_role values '
        f'→ SheetRowRoleTrigger rows.'
    )


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0031_sheet_control_v2_base'),
    ]

    operations = [
        # ── 1. Create SheetRowRoleTrigger (without row FK yet — added below) ─
        migrations.CreateModel(
            name='SheetRowRoleTrigger',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(choices=[('admin', 'Admin'), ('export_manager', 'Export Manager'), ('loading_dept_head', 'Loading Dept Head'), ('warehouse_chief', 'Warehouse Chief'), ('weight_master', 'Weight Master'), ('document_team', 'Document Team'), ('transport', 'Transport'), ('sales_rep', 'Sales Rep'), ('finansist', 'Finansist'), ('director', 'Director'), ('accountant', 'Accountant'), ('greenhouse_manager', 'Greenhouse Manager'), ('seller', 'Seller'), ('boss', 'Boss')], max_length=30)),
            ],
            options={
                'db_table': 'export_sheet_row_role_trigger',
            },
        ),
        migrations.AddField(
            model_name='sheetrowroletrigger',
            name='row',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='role_triggers',
                to='export.sheetrowsetting',
            ),
        ),
        migrations.AddConstraint(
            model_name='sheetrowroletrigger',
            constraint=models.UniqueConstraint(fields=('row', 'role'), name='uq_sheet_row_role'),
        ),

        # ── 2. Data step: migrate triggered_role → SheetRowRoleTrigger ─────
        migrations.RunPython(
            migrate_role_triggers,
            reverse_code=migrations.RunPython.noop,
        ),

        # ── 3. Remove CheckConstraint BEFORE removing the column ───────────
        # MSSQL errors if you drop a column while a constraint still references it.
        migrations.RemoveConstraint(
            model_name='sheetrowsetting',
            name='sheet_row_setting_role_xor_user',
        ),

        # ── 4. Remove triggered_role field ────────────────────────────────
        migrations.RemoveField(
            model_name='sheetrowsetting',
            name='triggered_role',
        ),
    ]
