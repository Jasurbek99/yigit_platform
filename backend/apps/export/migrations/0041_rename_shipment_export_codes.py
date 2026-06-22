"""Rename the two shipment code fields to consistent names.

Naming cleanup (no schema/data change at the column level):
  - Shipment.cargo_code            -> Shipment.shipment_code      (system-generated)
  - Shipment.official_export_code  -> Shipment.export_code        (operator-typed)
  - CustomsExpense.cargo_code_raw  -> CustomsExpense.shipment_code_raw

All three keep their original physical DB columns via db_column, so every
operation here is STATE-ONLY (zero ALTER TABLE / zero MSSQL risk):

  - shipment_code already mapped to db_column='code' before and after, so a
    plain RenameField emits no SQL.
  - export_code / shipment_code_raw gain an explicit db_column matching the old
    column name; wrapping the rename in SeparateDatabaseAndState guarantees no
    column-rename SQL is generated.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('export', '0040_alter_customsexpense_cargo_code_raw'),
    ]

    operations = [
        # db_column='code' on both sides -> no SQL.
        migrations.RenameField(
            model_name='shipment',
            old_name='cargo_code',
            new_name='shipment_code',
        ),
        # Physical column stays 'official_export_code'; state-only rename.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RenameField(
                    model_name='shipment',
                    old_name='official_export_code',
                    new_name='export_code',
                ),
                migrations.AlterField(
                    model_name='shipment',
                    name='export_code',
                    field=models.CharField(
                        blank=True,
                        db_column='official_export_code',
                        db_index=True,
                        max_length=30,
                        null=True,
                    ),
                ),
            ],
            database_operations=[],
        ),
        # Physical column stays 'cargo_code_raw'; state-only rename.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RenameField(
                    model_name='customsexpense',
                    old_name='cargo_code_raw',
                    new_name='shipment_code_raw',
                ),
                migrations.AlterField(
                    model_name='customsexpense',
                    name='shipment_code_raw',
                    field=models.CharField(
                        blank=True,
                        db_column='cargo_code_raw',
                        max_length=50,
                        null=True,
                    ),
                ),
            ],
            database_operations=[],
        ),
    ]
