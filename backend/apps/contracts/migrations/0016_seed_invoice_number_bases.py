from django.db import migrations
from django.db.models import Max


def seed_invoice_number_bases(apps, schema_editor):
    """Floor each (export firm, year) at the highest invoice number already in the DB.

    Only a floor: the DB holds a fraction of the invoices Excel issued, so an admin
    must type the real last numbers on «Нумерация инвойсов» before go-live (spec,
    Deploy step 2).
    """
    ContractSale = apps.get_model('contracts', 'ContractSale')
    InvoiceNumberBase = apps.get_model('contracts', 'InvoiceNumberBase')
    rows = (
        ContractSale.objects.filter(invoice_number__isnull=False, invoice_date__isnull=False)
        .order_by()  # Meta.ordering would leak into the GROUP BY
        .values('contract__export_firm_id', 'invoice_date__year')
        .annotate(top=Max('invoice_number'))
    )
    for row in rows:
        InvoiceNumberBase.objects.update_or_create(
            export_firm_id=row['contract__export_firm_id'],
            year=row['invoice_date__year'],
            defaults={'last_number': row['top']},
        )


class Migration(migrations.Migration):
    dependencies = [
        ('contracts', '0015_invoicenumberbase_contractsale_invoice_printed_at'),
    ]

    operations = [
        migrations.RunPython(seed_invoice_number_bases, migrations.RunPython.noop),
    ]
