"""Demote already-seeded director / export_manager from admin pages.

Removes admin.* page rows from director and the lone admin.permissions leak
from export_manager. Without this, environments that previously ran
seed_permissions still have those rows present and the admin/director
separation is a no-op. Idempotent — safe to re-run.

Reverse migration is a no-op; re-seed with `manage.py seed_permissions
--reset` if you need to restore prior defaults.
"""
from django.db import migrations


def demote_director_and_em(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')

    # Drop all admin.* page rows from director (analytics.boss survives — different prefix).
    RolePagePermission.objects.filter(
        role='director',
        page_code__startswith='admin.',
    ).delete()

    # Drop the explicit admin.permissions seed leak from export_manager.
    RolePagePermission.objects.filter(
        role='export_manager',
        page_code='admin.permissions',
    ).delete()


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0015_add_admin_role'),
    ]

    operations = [
        migrations.RunPython(demote_director_and_em, noop_reverse),
    ]
