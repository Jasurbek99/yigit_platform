"""Migration B1: add TaskRule and Task models for the structural-task system.

TaskRule is the recipe table; Task is the work-unit table.
TaskRule is created first because Task has a FK to it.
The blocked_by M2M self-join is added in a separate AddField after
CreateModel (mirrors Django autogen behaviour for self-referential M2M).
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0009_add_customs_planned_day'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # --- TaskRule (recipe, no FKs to Task) ---
        migrations.CreateModel(
            name='TaskRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('step', models.CharField(
                    db_index=True, max_length=32,
                    help_text='Shipment status code that triggers this rule',
                )),
                ('title_key', models.CharField(
                    max_length=128,
                    help_text='i18n key, e.g. tasks.fill_loading_data',
                )),
                ('assignee_role', models.CharField(
                    max_length=32,
                    help_text='Role that owns the generated Task by default',
                )),
                ('target_fields', models.CharField(
                    blank=True, default='', max_length=512,
                    help_text='CSV of Shipment field_keys; whitespace-trimmed on read',
                )),
                ('completion_rule', models.CharField(
                    choices=[
                        ('all_fields_filled', 'All target fields filled'),
                        ('any_field_filled', 'Any target field filled'),
                        ('manual_done', 'Marked done manually'),
                    ],
                    default='all_fields_filled', max_length=24,
                )),
                ('deadline_rule', models.CharField(
                    blank=True, default='', max_length=64,
                    help_text='Grammar parsed in services/task_rules.py; e.g. 13:00_same_day',
                )),
                ('condition_field', models.CharField(
                    blank=True, default='', max_length=64,
                    help_text='Shipment attr name for the gating condition; blank = always match',
                )),
                ('condition_value', models.CharField(
                    blank=True, default='', max_length=64,
                    help_text='String-cast comparison: str(getattr(shipment, condition_field)) == condition_value',
                )),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'db_table': 'export_task_rule',
            },
        ),
        migrations.AddIndex(
            model_name='taskrule',
            index=models.Index(fields=['step', 'is_active'], name='export_task_step_9b30cb_idx'),
        ),

        # --- Task (work unit; FK to TaskRule and Shipment) ---
        migrations.CreateModel(
            name='Task',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('shipment', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='tasks', to='export.shipment',
                )),
                ('step', models.CharField(
                    db_index=True, max_length=32,
                    help_text='Shipment status when the task was generated',
                )),
                ('rule', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='tasks', to='export.taskrule',
                    help_text='Rule that generated this task; null if ad-hoc',
                )),
                ('title_key', models.CharField(max_length=128)),
                ('assignee_role', models.CharField(db_index=True, max_length=32)),
                ('assignee_user', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='+', to=settings.AUTH_USER_MODEL,
                    help_text='Set when a specific user picks up the task',
                )),
                ('target_fields', models.CharField(blank=True, default='', max_length=512)),
                ('completion_rule', models.CharField(
                    choices=[
                        ('all_fields_filled', 'All target fields filled'),
                        ('any_field_filled', 'Any target field filled'),
                        ('manual_done', 'Marked done manually'),
                    ],
                    default='all_fields_filled', max_length=24,
                )),
                ('deadline', models.DateTimeField(
                    blank=True, db_index=True, null=True,
                    help_text='Computed at task creation from rule.deadline_rule',
                )),
                ('deadline_rule', models.CharField(blank=True, default='', max_length=64)),
                ('state', models.CharField(
                    choices=[
                        ('open', 'Open'),
                        ('in_progress', 'In progress'),
                        ('blocked', 'Blocked'),
                        ('done', 'Done'),
                        ('cancelled', 'Cancelled'),
                    ],
                    db_index=True, default='open', max_length=16,
                )),
                ('blocked_reason', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
            ],
            options={
                'db_table': 'export_task',
            },
        ),
        # Self-referential M2M must be added after CreateModel
        migrations.AddField(
            model_name='task',
            name='blocked_by',
            field=models.ManyToManyField(
                blank=True,
                related_name='blocking',
                symmetrical=False,
                to='export.task',
                help_text='Tasks that must complete before this one can be worked on',
            ),
        ),
        migrations.AddIndex(
            model_name='task',
            index=models.Index(fields=['shipment', 'state'], name='export_task_shipmen_e7db76_idx'),
        ),
        migrations.AddIndex(
            model_name='task',
            index=models.Index(fields=['assignee_role', 'state'], name='export_task_assigne_250b44_idx'),
        ),
        migrations.AddIndex(
            model_name='task',
            index=models.Index(fields=['state', 'deadline'], name='export_task_state_577027_idx'),
        ),
    ]
