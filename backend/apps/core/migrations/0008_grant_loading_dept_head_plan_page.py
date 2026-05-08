"""Grant the loading_dept_head role visibility for the export.plan page.

The seed_permissions command uses `get_or_create`, which never updates an
existing row. Earlier seed runs created the loading_dept_head × export.plan
RolePagePermission with is_visible=False (because export.plan was not in the
role's defaults at the time). Flipping that single row by hand here is
cheaper than asking ops to run `seed_permissions --reset`.

If the row does not yet exist (fresh DB), the next `seed_permissions` run
will create it with is_visible=True from the updated PAGE_DEFAULTS, so this
migration is idempotent: it updates if present, otherwise no-ops.
"""
import os

from django.db import migrations


def grant_plan_page(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RolePagePermission.objects.filter(
        role='loading_dept_head',
        page_code='export.plan',
        is_visible=False,
    ).update(is_visible=True)


def revoke_plan_page(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RolePagePermission.objects.filter(
        role='loading_dept_head',
        page_code='export.plan',
        is_visible=True,
    ).update(is_visible=False)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0007_pre_simplejwt_drop_blacklisted_token_unique'),
    ]

    operations = [
        migrations.RunPython(grant_plan_page, reverse_code=revoke_plan_page),
    ]
