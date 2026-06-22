"""Reconstructed: align Notification.kind choices with the model.

The original 0039_alter_notification_kind file went missing from disk. The live
DB already had 0040 applied (repointed to 0038 to skip the gap), so re-inserting
the notification alter at 0039 would make history inconsistent (an applied 0040
depending on an unapplied 0039). Instead it is rebuilt at the tip of the chain
(0043, after 0042) from the current Notification.KIND_CHOICES. CharField
`choices` are not enforced at the DB level, so this is a STATE-ONLY AlterField
(no SQL); replaying it makes the migration state match the model.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0042_rename_code_field_keys'),
    ]

    operations = [
        migrations.AlterField(
            model_name='notification',
            name='kind',
            field=models.CharField(
                max_length=30,
                choices=[
                    ('quota_80', 'Quota 80%'),
                    ('quota_90', 'Quota 90%'),
                    ('quota_95', 'Quota 95%'),
                    ('quota_100', 'Quota 100%'),
                    ('overdue', 'Overdue shipment'),
                    ('action_required', 'Action required'),
                    ('forecast_nudge', 'Forecast nudge'),
                    ('forecast_handoff', 'Forecast handoff'),
                    ('forecast_escalation', 'Forecast escalation'),
                    ('plan_deadline_reminder', 'Plan deadline reminder'),
                    ('plan_late', 'Plan late'),
                    ('plan_critical_late', 'Plan critical-late'),
                    ('mention', 'Mention'),
                    ('task_assigned', 'Task assigned'),
                    ('task_done', 'Task done'),
                    ('feedback_resolved', 'Feedback resolved'),
                    ('feedback_rejected', 'Feedback rejected'),
                    ('stuck_8d', 'Stuck shipment — 8 days'),
                    ('stuck_15d', 'Stuck shipment — 15 days'),
                    ('stuck_30d', 'Stuck shipment — 30+ days'),
                    ('plan_submitted', 'Plan submitted (deprecated)'),
                    ('plan_approved', 'Plan approved (deprecated)'),
                    ('plan_rejected', 'Plan rejected (deprecated)'),
                ],
            ),
        ),
    ]
