# Migration 0033 — SheetRowUserPermission model (ADR-0009)
#
# Creates the per-user extra-grant table for Sheet Control v2.
# The partial UniqueConstraint (condition=deleted_at IS NULL) becomes a
# filtered index on MSSQL — correct behaviour, no special handling needed.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0032_sheet_row_role_trigger'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='SheetRowUserPermission',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                (
                    'can_edit',
                    models.BooleanField(
                        default=True,
                        help_text='When False, this is a read-only grant (reserved for future use).',
                    ),
                ),
                (
                    'deleted_at',
                    models.DateTimeField(blank=True, db_index=True, null=True),
                ),
                (
                    'created_at',
                    models.DateTimeField(auto_now_add=True),
                ),
            ],
            options={
                'db_table': 'export_sheet_row_user_permission',
            },
        ),
        migrations.AddField(
            model_name='sheetrowuserpermission',
            name='created_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='sheetrowuserpermission',
            name='deleted_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='sheetrowuserpermission',
            name='row',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='user_permissions',
                to='export.sheetrowsetting',
            ),
        ),
        migrations.AddField(
            model_name='sheetrowuserpermission',
            name='user',
            field=models.ForeignKey(
                help_text='SET_NULL on user deletion to preserve history (ADR-0002).',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='sheet_row_permissions',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddConstraint(
            model_name='sheetrowuserpermission',
            constraint=models.UniqueConstraint(
                condition=models.Q(('deleted_at__isnull', True)),
                fields=('row', 'user'),
                name='uq_active_row_user',
            ),
        ),
    ]
