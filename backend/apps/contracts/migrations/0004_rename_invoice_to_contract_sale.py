"""Rename Invoice → ContractSale (model + physical table).

Hand-authored as a RenameModel (NOT delete+create) so the existing
``contracts_invoice`` table and its rows are preserved. The autodetector
emits delete+create when run non-interactively, which would drop the data.

Step 1 renames the model state. Step 2 renames the physical table to
``contracts_contract_sale``. The related_name changes (invoices → sales)
are state-only (no DDL) and live in the next migration.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('contracts', '0003_contractattachment'),
    ]

    operations = [
        migrations.RenameModel(
            old_name='Invoice',
            new_name='ContractSale',
        ),
        migrations.AlterModelTable(
            name='contractsale',
            table='contracts_contract_sale',
        ),
    ]
