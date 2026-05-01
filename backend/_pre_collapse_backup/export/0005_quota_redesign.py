# Custom migration for quota redesign — MSSQL-compatible.
# Django's auto-generated operations hit MSSQL constraint-naming bugs.
# Doing it all in RunSQL with state_operations to keep Django's ORM in sync.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


# Forward SQL split into steps — MSSQL can't reference new columns in CHECK constraints
# within the same batch that adds them.
FORWARD_SQL_STEP1 = """
-- 1. Drop old constraints and FK
ALTER TABLE [export].[quota_allocations] DROP CONSTRAINT [uq_quota_season_firm];
"""

FORWARD_SQL_STEP2 = """
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'export_quota_allocations_season_id_8adc96d3_fk_core_seasons_id')
    ALTER TABLE [export].[quota_allocations] DROP CONSTRAINT [export_quota_allocations_season_id_8adc96d3_fk_core_seasons_id];
"""

FORWARD_SQL_STEP3 = """
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'export_quota_allocations_season_id_8adc96d3' AND object_id = OBJECT_ID('[export].[quota_allocations]'))
    DROP INDEX [export_quota_allocations_season_id_8adc96d3] ON [export].[quota_allocations];
"""

FORWARD_SQL_STEP4 = """
ALTER TABLE [export].[quota_allocations] DROP COLUMN [season_id];
"""

FORWARD_SQL_STEP5 = """
ALTER TABLE [export].[quota_allocations] ADD
    [domestic_sale_kg] DECIMAL(12,2) NOT NULL DEFAULT 0,
    [domestic_sale_date] DATE NULL,
    [expected_kg] DECIMAL(12,2) NOT NULL DEFAULT 0,
    [valid_from] DATE NOT NULL DEFAULT '2026-01-01',
    [valid_to] DATE NOT NULL DEFAULT '2026-01-31',
    [created_at] DATETIMEOFFSET NULL DEFAULT SYSDATETIMEOFFSET(),
    [created_by] BIGINT NULL,
    [notes] NVARCHAR(500) NOT NULL DEFAULT '';
"""

FORWARD_SQL_STEP6 = """
ALTER TABLE [export].[quota_allocations]
    ADD CONSTRAINT [export_quota_allocations_created_by_fk_sys_users]
    FOREIGN KEY ([created_by]) REFERENCES [sys_users]([id]);
"""

FORWARD_SQL_STEP7 = """
DELETE FROM [export].[quota_allocations];
"""

FORWARD_SQL_STEP8 = """
ALTER TABLE [export].[quota_allocations]
    ADD CONSTRAINT [chk_quota_domestic_sale_gt0] CHECK ([domestic_sale_kg] > 0);
"""

FORWARD_SQL_STEP9 = """
ALTER TABLE [export].[quota_allocations]
    ADD CONSTRAINT [chk_quota_valid_range] CHECK ([valid_to] >= [valid_from]);
"""

# Reverse SQL: restore the old schema
REVERSE_SQL = """
-- Drop new constraints
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_quota_valid_range')
    ALTER TABLE [export].[quota_allocations] DROP CONSTRAINT [chk_quota_valid_range];
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_quota_domestic_sale_gt0')
    ALTER TABLE [export].[quota_allocations] DROP CONSTRAINT [chk_quota_domestic_sale_gt0];
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'export_quota_allocations_created_by_fk_sys_users')
    ALTER TABLE [export].[quota_allocations] DROP CONSTRAINT [export_quota_allocations_created_by_fk_sys_users];

-- Drop new columns
ALTER TABLE [export].[quota_allocations] DROP COLUMN
    [domestic_sale_kg], [domestic_sale_date], [expected_kg],
    [valid_from], [valid_to], [created_at], [created_by], [notes];

-- Re-add season_id
ALTER TABLE [export].[quota_allocations] ADD [season_id] INT NOT NULL DEFAULT 1;
ALTER TABLE [export].[quota_allocations]
    ADD CONSTRAINT [export_quota_allocations_season_id_8adc96d3_fk_core_seasons_id]
    FOREIGN KEY ([season_id]) REFERENCES [core].[seasons]([id]);
ALTER TABLE [export].[quota_allocations]
    ADD CONSTRAINT [uq_quota_season_firm] UNIQUE ([season_id], [export_firm_id]);
"""


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0003_truck_destination'),
        ('export', '0004_weeklyharvestplan_actual_weekly_total'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD_SQL_STEP1, reverse_sql=migrations.RunSQL.noop),
        migrations.RunSQL(sql=FORWARD_SQL_STEP2, reverse_sql=migrations.RunSQL.noop),
        migrations.RunSQL(sql=FORWARD_SQL_STEP3, reverse_sql=migrations.RunSQL.noop),
        migrations.RunSQL(sql=FORWARD_SQL_STEP4, reverse_sql=migrations.RunSQL.noop),
        migrations.RunSQL(sql=FORWARD_SQL_STEP5, reverse_sql=migrations.RunSQL.noop),
        migrations.RunSQL(sql=FORWARD_SQL_STEP6, reverse_sql=migrations.RunSQL.noop),
        migrations.RunSQL(sql=FORWARD_SQL_STEP7, reverse_sql=migrations.RunSQL.noop),
        migrations.RunSQL(sql=FORWARD_SQL_STEP8, reverse_sql=migrations.RunSQL.noop),
        migrations.RunSQL(
            sql=FORWARD_SQL_STEP9,
            reverse_sql=REVERSE_SQL,
            state_operations=[
                migrations.AlterModelOptions(
                    name='quotaallocation',
                    options={'ordering': ['valid_from', 'export_firm__name_en']},
                ),
                migrations.RemoveConstraint(
                    model_name='quotaallocation',
                    name='uq_quota_season_firm',
                ),
                migrations.RemoveField(
                    model_name='quotaallocation',
                    name='season',
                ),
                migrations.AddField(
                    model_name='quotaallocation',
                    name='created_at',
                    field=models.DateTimeField(auto_now_add=True, null=True),
                ),
                migrations.AddField(
                    model_name='quotaallocation',
                    name='created_by',
                    field=models.ForeignKey(blank=True, db_column='created_by', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='quotas_created', to=settings.AUTH_USER_MODEL),
                ),
                migrations.AddField(
                    model_name='quotaallocation',
                    name='domestic_sale_date',
                    field=models.DateField(blank=True, help_text='Date of the domestic sale', null=True),
                ),
                migrations.AddField(
                    model_name='quotaallocation',
                    name='domestic_sale_kg',
                    field=models.DecimalField(decimal_places=2, default=0, help_text='Weight sold on local market that earned this quota', max_digits=12),
                ),
                migrations.AddField(
                    model_name='quotaallocation',
                    name='expected_kg',
                    field=models.DecimalField(decimal_places=2, default=0, help_text='domestic_sale_kg × 10 — what government should give', max_digits=12),
                ),
                migrations.AddField(
                    model_name='quotaallocation',
                    name='notes',
                    field=models.CharField(blank=True, default='', max_length=500),
                ),
                migrations.AddField(
                    model_name='quotaallocation',
                    name='valid_from',
                    field=models.DateField(default='2026-01-01', help_text='Start of quota validity (user-entered)'),
                ),
                migrations.AddField(
                    model_name='quotaallocation',
                    name='valid_to',
                    field=models.DateField(default='2026-01-31', help_text='End of quota validity (user-entered)'),
                ),
                migrations.AlterField(
                    model_name='quotaallocation',
                    name='granted_kg',
                    field=models.DecimalField(decimal_places=2, help_text='What government actually gave (clerk decision)', max_digits=12),
                ),
                migrations.AlterField(
                    model_name='quotaallocation',
                    name='used_kg',
                    field=models.DecimalField(decimal_places=2, default=0, help_text='Consumed by shipments (calculated via FIFO)', max_digits=12),
                ),
                migrations.AddConstraint(
                    model_name='quotaallocation',
                    constraint=models.CheckConstraint(condition=models.Q(('domestic_sale_kg__gt', 0)), name='chk_quota_domestic_sale_gt0'),
                ),
                migrations.AddConstraint(
                    model_name='quotaallocation',
                    constraint=models.CheckConstraint(condition=models.Q(('valid_to__gte', models.F('valid_from'))), name='chk_quota_valid_range'),
                ),
            ],
        ),
    ]
