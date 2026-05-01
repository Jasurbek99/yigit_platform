# Add approval workflow fields to QuotaUsageRecord — MSSQL-safe

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0014_add_quota_usage_record'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='quotausagerecord',
            options={'ordering': ['-usage_date', 'export_firm']},
        ),
        # All new columns via RunSQL to avoid MSSQL constraint-name issues
        migrations.RunSQL(
            sql="""
                ALTER TABLE [export].[quota_usage_records] ADD
                    [approved_at] datetimeoffset NULL,
                    [approved_by_id] bigint NULL,
                    [created_by_id] bigint NULL,
                    [shipment_id] bigint NULL,
                    [status] nvarchar(20) NOT NULL DEFAULT 'draft',
                    [created_at] datetimeoffset NULL DEFAULT SYSDATETIMEOFFSET();

                ALTER TABLE [export].[quota_usage_records]
                    ADD CONSTRAINT [fk_usage_approved_by] FOREIGN KEY ([approved_by_id])
                        REFERENCES [dbo].[sys_users] ([id]);

                ALTER TABLE [export].[quota_usage_records]
                    ADD CONSTRAINT [fk_usage_created_by] FOREIGN KEY ([created_by_id])
                        REFERENCES [dbo].[sys_users] ([id]);

                ALTER TABLE [export].[quota_usage_records]
                    ADD CONSTRAINT [fk_usage_shipment] FOREIGN KEY ([shipment_id])
                        REFERENCES [export].[shipments] ([id])
                        ON DELETE SET NULL;
            """,
            reverse_sql="""
                ALTER TABLE [export].[quota_usage_records] DROP CONSTRAINT IF EXISTS [fk_usage_shipment];
                ALTER TABLE [export].[quota_usage_records] DROP CONSTRAINT IF EXISTS [fk_usage_created_by];
                ALTER TABLE [export].[quota_usage_records] DROP CONSTRAINT IF EXISTS [fk_usage_approved_by];
                ALTER TABLE [export].[quota_usage_records] DROP COLUMN IF EXISTS
                    [approved_at], [approved_by_id], [created_by_id],
                    [shipment_id], [status], [created_at];
            """,
            state_operations=[
                migrations.AddField(
                    model_name='quotausagerecord',
                    name='approved_at',
                    field=models.DateTimeField(blank=True, null=True),
                ),
                migrations.AddField(
                    model_name='quotausagerecord',
                    name='approved_by',
                    field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='quota_usages_approved', to=settings.AUTH_USER_MODEL),
                ),
                migrations.AddField(
                    model_name='quotausagerecord',
                    name='created_by',
                    field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='quota_usages_created', to=settings.AUTH_USER_MODEL),
                ),
                migrations.AddField(
                    model_name='quotausagerecord',
                    name='created_at',
                    field=models.DateTimeField(auto_now_add=True, null=True),
                ),
                migrations.AddField(
                    model_name='quotausagerecord',
                    name='shipment',
                    field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='quota_usage_records', to='export.shipment'),
                ),
                migrations.AddField(
                    model_name='quotausagerecord',
                    name='status',
                    field=models.CharField(choices=[('draft', 'Draft'), ('approved', 'Approved')], default='draft', max_length=20),
                ),
            ],
        ),
        # Set existing imported records to 'approved'
        migrations.RunSQL(
            sql="UPDATE [export].[quota_usage_records] SET [status] = 'approved' WHERE [notes] = 'Imported from quota.xlsx';",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
