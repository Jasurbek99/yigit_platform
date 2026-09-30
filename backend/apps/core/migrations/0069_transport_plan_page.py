"""Register /transport/plan (planning tasks, 2026-09-29) and let transport read the
truck allocation behind it.

seed_permissions only get_or_creates on a fresh DB and production runs `migrate`
only, so a registered page code with no rows is hidden from EVERY role (fail
closed — see core/0039). Every role gets a row; /admin/permissions Save deletes
and recreates page rows, so a partial matrix silently loses access (core/0054).

get_or_create for pages — a re-run must not stomp an admin's toggle. The
truck_allocation grant only ever turns can_view ON; other flags are untouched.
"""
from django.db import migrations

# Snapshot of ROLE_CHOICES at write time — a later role is seeded by seed_permissions.
ALL_ROLES = (
    'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy',
    'warehouse_chief', 'weight_master', 'document_team', 'transport', 'sales_rep',
    'finansist', 'director', 'accountant', 'greenhouse_manager', 'seller',
    'quality_inspector', 'garawul', 'boss',
)
VISIBLE_ROLES = frozenset({'admin', 'boss', 'director', 'export_manager', 'document_team', 'transport'})
PAGE_CODE = 'transport.plan'


def seed_transport_plan(RolePagePermission, RoleResourcePermission) -> int:
    """Create the missing rows and the view grant. Returns page rows created.

    Split out of the RunPython callable so tests can drive it directly — the
    migration itself returns early on a ``test_``-prefixed database.
    """
    created = 0
    for role in ALL_ROLES:
        _, was_created = RolePagePermission.objects.get_or_create(
            role=role, page_code=PAGE_CODE, defaults={'is_visible': role in VISIBLE_ROLES},
        )
        created += int(was_created)
    grant, _ = RoleResourcePermission.objects.get_or_create(
        role='transport', resource_code='truck_allocation',
        defaults={'can_view': True, 'can_create': False, 'can_edit': False, 'can_delete': False},
    )
    if not grant.can_view:
        grant.can_view = True
        grant.save(update_fields=['can_view'])
    return created


def _wipe_perm_cache() -> None:
    """Best-effort flush of the 60 s per-role permission caches."""
    try:
        from django.core.cache import cache

        from apps.core.views_permissions import PERM_CACHE_PREFIX
        cache.delete_many(
            [f'{PERM_CACHE_PREFIX}:pages:{r}' for r in ALL_ROLES]
            + [f'{PERM_CACHE_PREFIX}:resources:transport']
        )
    except Exception:
        pass


def apply(apps, schema_editor):
    # Gated on the connection, not an env var — see core/0033 and core/0039.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    seed_transport_plan(
        apps.get_model('core', 'RolePagePermission'),
        apps.get_model('core', 'RoleResourcePermission'),
    )
    _wipe_perm_cache()


def unapply(apps, schema_editor):
    """Reverse: drop the page rows (the page then fails closed). The view grant
    stays — it may predate this migration, and it is read-only."""
    apps.get_model('core', 'RolePagePermission').objects.filter(page_code=PAGE_CODE).delete()
    _wipe_perm_cache()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0068_loading_dept_assign_page'),
    ]

    operations = [
        migrations.RunPython(apply, reverse_code=unapply),
    ]
