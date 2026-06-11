from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0033_sheetrowsetting_style_font_size'),
    ]

    operations = [
        migrations.AlterField(
            model_name='notification',
            name='kind',
            field=models.CharField(
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
                max_length=30,
            ),
        ),
    ]
