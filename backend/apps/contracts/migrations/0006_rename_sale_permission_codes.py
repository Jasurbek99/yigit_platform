"""Rename the contract-sale permission codes on existing rows.

The resource was renamed Invoice → ContractSale, so the seeded permission
rows must follow:
    RoleResourcePermission.resource_code  'invoice'           → 'sale'
    RolePagePermission.page_code          'contracts.invoices'→ 'contracts.sales'

Guarded UPDATEs (filter old → set new) so it's idempotent and safe to re-run.
Without this, the page fail-closes (vanishes for every role) and the resource
gate denies everyone on beta, even though tests — which seed their own perms —
would stay green.
"""
from django.db import migrations

OLD_RESOURCE = 'invoice'
NEW_RESOURCE = 'sale'
OLD_PAGE = 'contracts.invoices'
NEW_PAGE = 'contracts.sales'


def rename_forward(apps, schema_editor):
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission.objects.filter(resource_code=OLD_RESOURCE).update(
        resource_code=NEW_RESOURCE,
    )
    RolePagePermission.objects.filter(page_code=OLD_PAGE).update(page_code=NEW_PAGE)


def rename_backward(apps, schema_editor):
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission.objects.filter(resource_code=NEW_RESOURCE).update(
        resource_code=OLD_RESOURCE,
    )
    RolePagePermission.objects.filter(page_code=NEW_PAGE).update(page_code=OLD_PAGE)


class Migration(migrations.Migration):

    dependencies = [
        ('contracts', '0005_alter_contractsale_contract_and_more'),
        ('core', '0023_exportfirm_name_short'),
    ]

    operations = [
        migrations.RunPython(rename_forward, rename_backward),
    ]
