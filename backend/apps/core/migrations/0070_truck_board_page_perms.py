"""Register the Truck Board page in the permission matrix (2026-09-29).

`export.truck_board` backs the screen where the export manager joins trips
planned in the external Planning system to regular shipments
(spec docs/superpowers/specs/2026-09-29-transport-trips-design.md).

Load-bearing, like `0056_task_rules_page_perms`: `CanViewTruckBoard` and the
frontend route guard read `get_page_permissions(role).get('export.truck_board',
False)`, which is fail-closed, and `seed_permissions` only runs on a fresh
install. Every other role gets an explicit `is_visible=False` row so an admin
can grant it without a deploy.

Post-deploy verification:
    RolePagePermission.objects.filter(page_code='export.truck_board').count()
must equal the number of roles in ALL_ROLES. If it comes back 0, this ran as a
no-op against a `test_`-prefixed database: delete the
('core', '0070_truck_board_page_perms') row from django_migrations and re-run
`migrate core` against the real database.
"""
from django.db import migrations

PAGE_CODE = 'export.truck_board'

# Mirrors ROLE_CHOICES (apps/core/models/user.py) as of 2026-09-30 (incl. garawul, core.0066), including
# `quality_inspector` (core.0053). Spelled out rather than imported so a later
# role addition cannot silently change what this migration wrote — a new role is
# seeded by `seed_permissions`, not backdated here.
ALL_ROLES = (
    'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy',
    'warehouse_chief', 'weight_master', 'document_team', 'transport',
    'quality_inspector', 'sales_rep', 'finansist', 'director', 'accountant',
    'greenhouse_manager', 'seller', 'boss', 'garawul',
)

# admin / director / export_manager / boss hold every page via _ALL_PAGES in
# `seed_permissions`, document_team copies export_manager's set, and transport is
# added there explicitly (read-only board). Keep the two lists in step.
VISIBLE_ROLES = frozenset({
    'admin', 'director', 'export_manager', 'document_team', 'boss', 'transport',
})


def seed_truck_board_page(RolePagePermission) -> int:
    """Create the missing rows. Returns how many were created.

    Split out of the RunPython callable so tests can drive it directly — the
    migration itself returns early on a ``test_``-prefixed database.
    """
    created = 0
    for role in ALL_ROLES:
        _, was_created = RolePagePermission.objects.get_or_create(
            role=role,
            page_code=PAGE_CODE,
            defaults={'is_visible': role in VISIBLE_ROLES},
        )
        created += int(was_created)
    return created


def _wipe_perm_cache() -> None:
    """Best-effort flush of the 60 s per-role page caches."""
    try:
        from django.core.cache import cache

        from apps.core.views_permissions import PERM_CACHE_PREFIX
        cache.delete_many([f'{PERM_CACHE_PREFIX}:pages:{r}' for r in ALL_ROLES])
    except Exception:
        pass


def apply_truck_board_page(apps, schema_editor):
    # Gated on the connection, not on os.environ['DJANGO_TESTING'] — see the
    # long note in 0033_boss_process_visibility_perms.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    seed_truck_board_page(apps.get_model('core', 'RolePagePermission'))
    _wipe_perm_cache()


def remove_truck_board_page(apps, schema_editor):
    """Reverse: drop the rows. The page then fails closed for every role."""
    apps.get_model('core', 'RolePagePermission').objects.filter(
        page_code=PAGE_CODE,
    ).delete()
    _wipe_perm_cache()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0069_transport_plan_page'),
    ]

    operations = [
        migrations.RunPython(apply_truck_board_page, reverse_code=remove_truck_board_page),
    ]
