"""Grant the new `sheet_row_setting` resource to admin / director / export_manager.

The Shipment Settings sheet-rows endpoint used to gate on `shipment.can_edit`,
which five non-admin roles hold. Writing a Sheet row trigger is becoming an
edit-permission grant (multi-task plan in progress, 2026-09-02; AD-17 entry
to follow once Task 11 lands), so the endpoint moves to its own resource ahead of that
change. Also grants export_manager the Admin: Shipment Settings page so he can
administer row access without an admin account.

can_delete=True (full CRUD): the task brief for this migration originally
specified can_delete=False, but that regresses live behaviour — director and
export_manager currently soft-delete Sheet rows through this endpoint (DELETE
/admin/sheet-rows/{id}/, gated on its own 30-day-hidden precondition inside the
view) via the 'shipment' resource's blanket CRUD grant. Task 1's stated goal is
"changes no Sheet behaviour"; can_delete=False breaks 4 existing tests
(test_delete_soft_deletes_row and siblings) with 403s. can_delete=True preserves
parity with the resource this endpoint used to gate on. This also matches
seed_permissions.RESOURCE_DEFAULTS, where admin/director/export_manager need no
explicit 'sheet_row_setting' override at all — they inherit full CRUD from their
existing `**{r: _VCRUD for r in _ALL_RESOURCES}` wildcard the moment the resource
code is registered, same mechanism 'boss' relies on.

Idempotent: update_or_create on the unique keys. Clears the permission cache so
live workers pick the rows up without a restart. reverse_code (revoke) is fully
symmetric with grant() — it deletes both the resource grant and the page-visibility
row, and clears the same cache keys, so `migrate core 0037` leaves no ghost
admin.shipment_settings tab and no stale positive-permission cache entry.
"""
import os

from django.db import migrations


ROLES = ['admin', 'director', 'export_manager']
RESOURCE = 'sheet_row_setting'
PAGE = 'admin.shipment_settings'


def grant(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RolePagePermission = apps.get_model('core', 'RolePagePermission')

    for role in ROLES:
        RoleResourcePermission.objects.update_or_create(
            role=role,
            resource_code=RESOURCE,
            defaults={
                'can_view': True,
                'can_create': True,
                'can_edit': True,
                'can_delete': True,
            },
        )
    RolePagePermission.objects.update_or_create(
        role='export_manager',
        page_code=PAGE,
        defaults={'is_visible': True},
    )

    try:
        from django.core.cache import cache
        keys = [f'dynamic_perms:resource:{r}:{RESOURCE}' for r in ROLES]
        # Also wipe the "all resources for this role" cache (/auth/me/ reads
        # this key, not the per-resource one above) so canDo() picks up the
        # new grant without waiting out the 60s TTL.
        keys += [f'dynamic_perms:resources:{r}' for r in ROLES]
        keys.append('dynamic_perms:pages:export_manager')
        cache.delete_many(keys)
    except Exception:
        pass


def revoke(apps, schema_editor):
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RolePagePermission = apps.get_model('core', 'RolePagePermission')

    RoleResourcePermission.objects.filter(
        role__in=ROLES, resource_code=RESOURCE,
    ).delete()
    # Symmetric with grant(): leaving this row behind would show export_manager
    # an admin.shipment_settings tab with no sheet_row_setting grant backing
    # it — the same class of ghost-page bug migration 0037 exists to close.
    RolePagePermission.objects.filter(
        role='export_manager', page_code=PAGE,
    ).delete()

    try:
        from django.core.cache import cache
        keys = [f'dynamic_perms:resource:{r}:{RESOURCE}' for r in ROLES]
        keys += [f'dynamic_perms:resources:{r}' for r in ROLES]
        keys.append('dynamic_perms:pages:export_manager')
        cache.delete_many(keys)
    except Exception:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0037_hide_dead_shipment_pages_greenhouse_manager'),
    ]

    operations = [
        migrations.RunPython(grant, reverse_code=revoke),
    ]
