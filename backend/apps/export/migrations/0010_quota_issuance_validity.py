# MSSQL-compatible: use RunSQL for CharField with default
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0009_quota_issuance_system'),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE [export].[quota_issuances] ADD [validity] VARCHAR(20) NOT NULL DEFAULT 'this_month';",
            reverse_sql="ALTER TABLE [export].[quota_issuances] DROP COLUMN [validity];",
            state_operations=[
                migrations.AddField(
                    model_name='quotaissuance',
                    name='validity',
                    field=models.CharField(
                        choices=[('this_month', 'This month only'), ('this_and_next', 'This month + next month'), ('next_month', 'Next month only')],
                        default='this_month',
                        max_length=20,
                    ),
                ),
            ],
        ),
    ]
