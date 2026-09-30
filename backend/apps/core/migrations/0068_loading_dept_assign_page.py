"""Give the loading department the Assignment board page (2026-09-29).

The board now joins, detaches and swaps packing, and the loading department
may do all three (JOIN_ROLES). `export.assign` already exists, so the head and
deputy rows usually exist with is_visible=False — flip them, or create them.
seed_permissions only runs on a fresh install, so a live database needs this.

Post-deploy check:
    RolePagePermission.objects.filter(page_code='export.assign',
        role__in=['loading_dept_head', 'loading_dept_head_deputy'], is_visible=True).count() == 2
If it is 0, this ran as a no-op against a `test_`-prefixed database: delete the
('core', '0068_loading_dept_assign_page') row from django_migrations and re-run
`migrate core` against the real database.
"""
from django.db import migrations

PAGE_CODE = 'export.assign'
ROLES = ('loading_dept_head', 'loading_dept_head_deputy')


def grant_assign_page(RolePagePermission) -> int:
    """Make the page visible for ROLES. Returns how many rows changed."""
    changed = 0
    for role in ROLES:
        row, created = RolePagePermission.objects.get_or_create(
            role=role, page_code=PAGE_CODE, defaults={'is_visible': True},
        )
        if created:
            changed += 1
        elif not row.is_visible:
            row.is_visible = True
            row.save(update_fields=['is_visible'])
            changed += 1
    return changed


def _wipe_perm_cache() -> None:
    """Best-effort flush of the 60 s per-role page caches."""
    try:
        from django.core.cache import cache

        from apps.core.views_permissions import PERM_CACHE_PREFIX
        cache.delete_many([f'{PERM_CACHE_PREFIX}:pages:{r}' for r in ROLES])
    except Exception:
        pass


def apply(apps, schema_editor):
    # Gated on the connection name — see 0033_boss_process_visibility_perms.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    grant_assign_page(apps.get_model('core', 'RolePagePermission'))
    _wipe_perm_cache()


def revert(apps, schema_editor):
    apps.get_model('core', 'RolePagePermission').objects.filter(
        page_code=PAGE_CODE, role__in=ROLES,
    ).update(is_visible=False)
    _wipe_perm_cache()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0067_seed_garawul_perms'),
    ]

    operations = [
        migrations.RunPython(apply, reverse_code=revert),
    ]
