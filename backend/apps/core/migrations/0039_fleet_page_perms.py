"""Register the two Fleet pages in the permission matrix (2026-09-03).

`transport.map` (Fleet Map) and `transport.fleet` (Fleet Management) were
gated by hardcoded role arrays — `FLEET_MAP_DENIED_ROLES` /
`SHIPMENT_EDITOR_ROLES` in `apps/transport/permissions.py`, mirrored by `roles`
arrays in `AppLayout.tsx` and `App.tsx` — so neither page appeared on the admin
permission screen and neither could be granted or revoked without a deploy.

Both codes are now in `PAGE_REGISTRY`, and every gate reads the matrix. That
makes this migration load-bearing: `get_page_permissions(role).get(code, False)`
is fail-closed, so a registered code with no rows hides the page from EVERY role
on a database that already exists. `seed_permissions` cannot cover it either —
it only ever `get_or_create`s, and it is not re-run on deploy.

Rows written here reproduce the hardcoded sets exactly, so nobody's access
changes on this deploy:

  * `transport.map`   — visible to every role except `seller` (owner request,
    2026-08-23), which gets an explicit `is_visible=False` row so the checkbox
    is present and an admin can reverse the decision without a migration.
  * `transport.fleet` — visible to admin / director / export_manager / boss
    plus warehouse_chief and the loading head + deputy; hidden for the rest.

`get_or_create`, not `update_or_create`: these are brand-new codes with no prior
rows, so there is nothing to heal, and a re-run must not stomp an admin's
manual toggle.

Post-deploy verification:
    RolePagePermission.objects.filter(page_code__startswith='transport.').count()
must equal 30 (15 roles x 2 codes). If it comes back 0, this ran as a no-op
against a `test_`-prefixed database: delete the ('core', '0039_fleet_page_perms')
row from django_migrations and re-run `migrate core` against the real database.
"""
from django.db import migrations

# Mirrors ROLE_CHOICES (apps/core/models/user.py) as of 2026-09-03. Spelled out
# rather than imported so a later role addition cannot silently change what this
# migration wrote — a new role is seeded by `seed_permissions`, not backdated here.
ALL_ROLES = (
    'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy',
    'warehouse_chief', 'weight_master', 'document_team', 'transport',
    'sales_rep', 'finansist', 'director', 'accountant', 'greenhouse_manager',
    'seller', 'boss',
)

# Fleet Map: everyone but the seller — the old FLEET_MAP_DENIED_ROLES deny-list.
MAP_HIDDEN_ROLES = frozenset({'seller'})

# Fleet Management: the old SHIPMENT_EDITOR_ROLES set that gated the CRUD views.
FLEET_VISIBLE_ROLES = frozenset({
    'admin', 'director', 'export_manager', 'boss',
    'warehouse_chief', 'loading_dept_head', 'loading_dept_head_deputy',
})

PAGES = {
    'transport.map': lambda role: role not in MAP_HIDDEN_ROLES,
    'transport.fleet': lambda role: role in FLEET_VISIBLE_ROLES,
}


def seed_fleet_pages(RolePagePermission) -> int:
    """Create the missing rows. Returns how many were created.

    Split out of the RunPython callable so tests can drive it directly — the
    migration itself returns early on a ``test_``-prefixed database.
    """
    created = 0
    for page_code, is_visible_for in PAGES.items():
        for role in ALL_ROLES:
            _, was_created = RolePagePermission.objects.get_or_create(
                role=role,
                page_code=page_code,
                defaults={'is_visible': is_visible_for(role)},
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


def apply_fleet_pages(apps, schema_editor):
    # Gated on the connection, not on os.environ['DJANGO_TESTING'] — see the
    # long note in 0033_boss_process_visibility_perms: Django records a
    # migration as applied whether or not its body ran, so an environment
    # variable left set in the shell would no-op this permanently and every
    # role would lose both fleet pages with no way to notice.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    seed_fleet_pages(apps.get_model('core', 'RolePagePermission'))
    _wipe_perm_cache()


def remove_fleet_pages(apps, schema_editor):
    """Reverse: drop the rows. The pages then fail closed for every role."""
    apps.get_model('core', 'RolePagePermission').objects.filter(
        page_code__in=tuple(PAGES),
    ).delete()
    _wipe_perm_cache()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0038_sheet_row_setting_resource'),
    ]

    operations = [
        migrations.RunPython(apply_fleet_pages, reverse_code=remove_fleet_pages),
    ]
