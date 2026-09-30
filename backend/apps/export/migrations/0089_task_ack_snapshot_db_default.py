"""DB-level DEFAULT '' on export_task.ack_snapshot (hotfix, 2026-09-29).

0085 added ack_snapshot as NOT NULL with a Django-side default only — Django
drops the column default after AddField. The beta server shares this database
but runs code that predates the column, so its task INSERTs omit ack_snapshot
and fail with "Cannot insert the value NULL". A DB DEFAULT keeps those inserts
valid; current code always sends a value, so nothing else changes.

State-only for Django (RunSQL): the model keeps default=''. Reversible.
"""
from django.db import migrations

CONSTRAINT = 'DF_export_task_ack_snapshot'


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0088_peregruz_question_and_report_approval'),
    ]

    operations = [
        migrations.RunSQL(
            sql=f"ALTER TABLE [export_task] ADD CONSTRAINT [{CONSTRAINT}] DEFAULT N'' FOR [ack_snapshot];",
            reverse_sql=f"ALTER TABLE [export_task] DROP CONSTRAINT [{CONSTRAINT}];",
        ),
    ]
