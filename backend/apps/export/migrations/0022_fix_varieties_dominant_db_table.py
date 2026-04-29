"""Pin Shipment.varieties_dominant through-table to its real DB name.

The auto-generated through-table name was '[export].[shipments]_varieties_dominant'
(parent db_table + '_' + field name), which mssql-django mis-quotes as
'[[export].[shipments]_varieties_dominant]' producing invalid SQL on every
SELECT/JOIN. The physical table on MSSQL was actually created as
'[export].[shipments_varieties_dominant]', so this migration is state-only —
it aligns Django's model state with the real DB without running ALTER TABLE.
"""
from django.db import migrations, models

from apps.core.db_utils import schema_table


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0021_comment_cells_tasks'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AlterField(
                    model_name='shipment',
                    name='varieties_dominant',
                    field=models.ManyToManyField(
                        blank=True,
                        db_table=schema_table('export', 'shipments_varieties_dominant'),
                        related_name='shipments_dominant_in',
                        to='core.tomatovariety',
                    ),
                ),
            ],
        ),
    ]
