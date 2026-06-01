# Generated for soft-delete (deactivate) feature on Shipment.

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0024_add_shipment_sheet_position'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='shipment',
            name='deleted_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='shipment',
            name='deleted_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='soft_deleted_shipments',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
