# MSSQL-compatible: use RunSQL + state_operations
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0005_quota_redesign'),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE [export].[quota_allocations] ADD [product_type] VARCHAR(20) NOT NULL DEFAULT 'tomato';",
            reverse_sql="ALTER TABLE [export].[quota_allocations] DROP COLUMN [product_type];",
            state_operations=[
                migrations.AddField(
                    model_name='quotaallocation',
                    name='product_type',
                    field=models.CharField(choices=[('tomato', 'Tomato'), ('pepper', 'Pepper')], default='tomato', max_length=20),
                ),
            ],
        ),
    ]
