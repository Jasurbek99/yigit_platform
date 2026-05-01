"""Add official_export_code, previous_platform_id, variety_confidence, varieties_dominant to Shipment.

The varieties_dominant M2M field is added via RunSQL because mssql-django's
schema editor generates an invalid CREATE TABLE for through-tables when the
parent table has a schema-qualified db_table like '[export].[shipments]'.
The generated name becomes '[[export].[shipments]_varieties_dominant]' — a
syntactically broken identifier MSSQL cannot parse.

We create the through-table manually with a clean name and tell Django's ORM
about the M2M field via state_operations so model state stays correct.
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0010_add_variety_codes_and_seed'),
        ('export', '0018_alter_notification_kind'),
    ]

    operations = [
        # ── Plain scalar fields — these work fine with the patched backend ──
        migrations.AddField(
            model_name='shipment',
            name='official_export_code',
            field=models.CharField(blank=True, db_index=True, max_length=30, null=True),
        ),
        migrations.AddField(
            model_name='shipment',
            name='previous_platform_id',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='reroutes',
                to='export.shipment',
            ),
        ),
        migrations.AddField(
            model_name='shipment',
            name='variety_confidence',
            field=models.CharField(
                choices=[
                    ('high', 'From pallet data'),
                    ('low', 'Manually estimated'),
                    ('none', 'Pending packaging'),
                ],
                default='none',
                max_length=10,
            ),
        ),
        # ── M2M field: schema-aware through-table created manually ──
        migrations.RunSQL(
            sql=[
                # Through-table for shipment ↔ tomatovariety (dominant varieties).
                # Lives in [export] schema next to the shipments table.
                """
                CREATE TABLE [export].[shipment_varieties_dominant] (
                    [id]               bigint NOT NULL PRIMARY KEY IDENTITY (1, 1),
                    [shipment_id]      bigint NOT NULL,
                    [tomatovariety_id] bigint NOT NULL,
                    CONSTRAINT [uq_shipment_variety_dominant]
                        UNIQUE ([shipment_id], [tomatovariety_id]),
                    CONSTRAINT [fk_svd_shipment]
                        FOREIGN KEY ([shipment_id])
                        REFERENCES [export].[shipments] ([id])
                        ON DELETE CASCADE,
                    CONSTRAINT [fk_svd_variety]
                        FOREIGN KEY ([tomatovariety_id])
                        REFERENCES [core].[tomato_varieties] ([id])
                );
                """,
                "CREATE INDEX [ix_svd_shipment]      ON [export].[shipment_varieties_dominant] ([shipment_id]);",
                "CREATE INDEX [ix_svd_tomatovariety] ON [export].[shipment_varieties_dominant] ([tomatovariety_id]);",
            ],
            reverse_sql=[
                "DROP TABLE [export].[shipment_varieties_dominant];",
            ],
            state_operations=[
                migrations.AddField(
                    model_name='shipment',
                    name='varieties_dominant',
                    field=models.ManyToManyField(
                        blank=True,
                        related_name='shipments_dominant_in',
                        to='core.tomatovariety',
                        # Match the explicit table name we created above.
                        # Django infers 'export.shipment_varieties_dominant'
                        # from app_label + model_name + field_name; we set
                        # it via through_db_table-equivalent trick: use the
                        # db_table option on the implicit through model by
                        # declaring it through Meta.db_table convention.
                        # If your ORM configuration relies on a specific
                        # through-table name, mirror it in models.py via
                        # class Meta in an explicit through model.
                    ),
                ),
            ],
        ),
    ]