"""Grant loading_dept_head visibility into the user-management + staff-access
pages so the delegated user-management feature (ADR-022) is reachable.

ADR-022 lets the loading department head create/edit/delete/reset-password the
deputy + weight_master roles, and grant those roles a subset of his own pages.
The backend gates enforce the bounds; this migration just makes the two entry
pages visible to the head's role:

- ``admin.users``        — the Users admin page (scoped list for the head)
- ``admin.staff_access`` — the delegated page-access editor (new in ADR-022)

``update_or_create`` forces ``is_visible=True`` even when migration 0018 already
cloned a hidden row onto the role. Idempotent + re-runnable. Clears the dynamic
permission cache so live workers pick up the change without a restart.

NOTE: the deputy role is deliberately NOT granted these pages — only the head
manages staff (per the ADR-022 scope decision).
"""
import os

from django.db import migrations

HEAD = 'loading_dept_head'
PAGES = ['admin.users', 'admin.staff_access']


def grant_pages(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return

    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    for page_code in PAGES:
        RolePagePermission.objects.update_or_create(
            role=HEAD,
            page_code=page_code,
            defaults={'is_visible': True},
        )
    _wipe_perm_cache()


def revoke_pages(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RolePagePermission.objects.filter(role=HEAD, page_code__in=PAGES).update(is_visible=False)
    _wipe_perm_cache()


def _wipe_perm_cache():
    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0019_alter_rolefieldpermission_role_and_more'),
    ]

    operations = [
        migrations.RunPython(grant_pages, reverse_code=revoke_pages),
    ]
