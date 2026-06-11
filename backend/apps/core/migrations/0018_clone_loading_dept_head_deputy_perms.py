"""Clone all loading_dept_head permission rows onto the new
loading_dept_head_deputy role.

The deputy role was added (June 2026) with the explicit requirement that its
access is identical to loading_dept_head. On the live beta DB the permission
matrix is stored as RolePagePermission / RoleResourcePermission /
RoleFieldPermission rows. `seed_permissions` uses get_or_create and will NOT
create rows for a role that did not exist at seed time, so without this
migration the deputy would have zero access until a destructive --reset.

We copy the *live* head rows (not re-derive from the seed dicts) so the deputy
inherits whatever the head currently has — including the incremental grants
from migrations 0008 / 0012 / 0013. Page rows are copied verbatim including
is_visible=False so the deputy's matrix is fully populated rather than relying
on default fall-through.

Idempotent: get_or_create on each unique key, re-runnable. Clears the dynamic
permission cache so live workers pick up the new rows without a restart.
"""
import os

from django.db import migrations

HEAD = 'loading_dept_head'
DEPUTY = 'loading_dept_head_deputy'


def clone_head_to_deputy(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return

    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')

    for page in RolePagePermission.objects.filter(role=HEAD):
        RolePagePermission.objects.get_or_create(
            role=DEPUTY,
            page_code=page.page_code,
            defaults={'is_visible': page.is_visible},
        )

    for res in RoleResourcePermission.objects.filter(role=HEAD):
        RoleResourcePermission.objects.get_or_create(
            role=DEPUTY,
            resource_code=res.resource_code,
            defaults={
                'can_view': res.can_view,
                'can_create': res.can_create,
                'can_edit': res.can_edit,
                'can_delete': res.can_delete,
            },
        )

    for field in RoleFieldPermission.objects.filter(role=HEAD):
        RoleFieldPermission.objects.get_or_create(
            role=DEPUTY,
            resource_code=field.resource_code,
            field_name=field.field_name,
        )

    _wipe_perm_cache()


def revoke_deputy(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')

    RolePagePermission.objects.filter(role=DEPUTY).delete()
    RoleResourcePermission.objects.filter(role=DEPUTY).delete()
    RoleFieldPermission.objects.filter(role=DEPUTY).delete()

    _wipe_perm_cache()


def _wipe_perm_cache():
    # Best-effort: clear the dynamic-permission cache so a running worker does
    # not keep serving an empty matrix for the deputy. Imported lazily — the
    # cache helper is live app code, not part of the frozen migration registry.
    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        # Never fail the migration on cache issues — a restart picks up the rows.
        pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0017_work_sessions'),
    ]

    operations = [
        migrations.RunPython(clone_head_to_deputy, reverse_code=revoke_deputy),
    ]
