"""Delete the RoleFieldPermission rows for `quality_document`.

The four certificate flags became DERIVED columns on 2026-09-22 when
certificates turned into file uploads — `services/quality.py` is their only
writer, and the serializer marks them read-only. A field-level EDIT grant on a
field nobody can write is not a permission, it is a tickbox on
/admin/permissions that silently does nothing.

`FIELD_REGISTRY['quality_document']` is now `[]`, which stops the rows being
recreated. This removes the ones already in the live matrix; without it they
linger, because the field-permission PUT is per-resource and would never visit
a resource that no longer lists any field.

Access to the certificates is unchanged and is enforced at the RESOURCE level:
`RoleResourcePermission(quality_document).can_edit` gates upload and delete.

Reverse restores the rows from the pre-2026-09-22 seed defaults, so a rollback
to the checkbox version finds its matrix intact.
"""
import os

from django.db import migrations

RESOURCE = 'quality_document'

# The seed defaults as they stood before this change: a wildcard for every role
# that held the resource. Used only on reverse.
LEGACY_WILDCARD_ROLES = ['admin', 'director', 'export_manager', 'document_team', 'boss']


def drop_field_perms(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return

    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    RoleFieldPermission.objects.filter(resource_code=RESOURCE).delete()
    _wipe_perm_cache()


def restore_field_perms(apps, schema_editor):
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')
    for role in LEGACY_WILDCARD_ROLES:
        RoleFieldPermission.objects.get_or_create(
            role=role, resource_code=RESOURCE, field_name='*',
        )
    _wipe_perm_cache()


def _wipe_perm_cache():
    # Best-effort, same as 0018/0054 — never fail a migration over a cache miss.
    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0054_seed_quality_inspector_perms'),
    ]

    operations = [
        migrations.RunPython(drop_field_perms, reverse_code=restore_field_perms),
    ]
