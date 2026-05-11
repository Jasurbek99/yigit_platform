"""Add Shipment.column_color — operator-picked hex tint for the Sheet column.

Lets admin and export_manager flag individual shipment columns with a colour
in the Shipment Sheet view. NULL = default theme.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0013_add_warehouse_document_notes'),
    ]

    operations = [
        migrations.AddField(
            model_name='shipment',
            name='column_color',
            field=models.CharField(max_length=7, null=True, blank=True),
        ),
    ]
