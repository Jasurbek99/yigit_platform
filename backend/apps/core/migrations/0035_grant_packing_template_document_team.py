"""Grant the `packing_template` resource (gross-net catalog) to document_team,
and register the resource for the roles that already hold blanket CRUD.

Background: `PackingTemplateViewSet` gated its writes on a hardcoded role tuple
(`write_permission('admin', 'director', 'export_manager')`), so the catalog never
appeared as a row in the admin permission matrix and could not be delegated. It
now uses `resource_write_permission('packing_template')` — reads stay open to
every authenticated user (the Sheet packing panel's dropdown), writes read the
matrix. Without this migration existing installs have no `packing_template` rows
at all, which would fail-closed for EVERY role including admin.

Grants (mirrors RESOURCE_DEFAULTS in seed_permissions):
  admin / director / export_manager / boss → full CRUD (they hold _VCRUD on
      every registered resource via the `_ALL_RESOURCES` spread)
  document_team → full CRUD (they build the CMR/Invoice packets, so they own
      the catalog they pick from — stakeholder request 2026-08-27)

Also flips the `export.packing_presets` page row for document_team, which is how
they reach the catalog page. An `update()` is required there — `seed_permissions`
uses `get_or_create(defaults={'is_visible': ...})` and will not flip a row that
already exists with is_visible=False.

Idempotent: get_or_create on the (role, resource_code) unique key + an
unconditional update on the page row. Re-runnable. Clears both shapes of the
permission cache so live workers pick the rows up without a restart.
"""
import os

from django.db import migrations


CRUD_ROLES = ['admin', 'director', 'export_manager', 'boss', 'document_team']
RESOURCE = 'packing_template'
PAGE = 'export.packing_presets'
PAGE_ROLE = 'document_team'


def grant_packing_template(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RolePagePermission = apps.get_model('core', 'RolePagePermission')

    for role in CRUD_ROLES:
        RoleResourcePermission.objects.get_or_create(
            role=role,
            resource_code=RESOURCE,
            defaults={
                'can_view': True,
                'can_create': True,
                'can_edit': True,
                'can_delete': True,
            },
        )

    updated = RolePagePermission.objects.filter(
        role=PAGE_ROLE, page_code=PAGE,
    ).update(is_visible=True)
    if not updated:
        RolePagePermission.objects.create(
            role=PAGE_ROLE, page_code=PAGE, is_visible=True,
        )

    try:
        from django.core.cache import cache
        from apps.core.views_permissions import PERM_CACHE_PREFIX
        keys = [f'{PERM_CACHE_PREFIX}:pages:{PAGE_ROLE}']
        for role in CRUD_ROLES:
            keys.append(f'{PERM_CACHE_PREFIX}:resource:{role}:{RESOURCE}')
            keys.append(f'{PERM_CACHE_PREFIX}:resources:{role}')
        cache.delete_many(keys)
    except Exception:
        # Cache wipe is best-effort — a worker restart picks up the rows anyway.
        pass


def revoke_packing_template(apps, schema_editor):
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission.objects.filter(
        role__in=CRUD_ROLES, resource_code=RESOURCE,
    ).delete()
    RolePagePermission.objects.filter(
        role=PAGE_ROLE, page_code=PAGE,
    ).update(is_visible=False)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0034_idempotencykey'),
    ]

    operations = [
        migrations.RunPython(grant_packing_template, reverse_code=revoke_packing_template),
    ]
