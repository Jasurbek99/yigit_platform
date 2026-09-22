"""Register the Task Rules reference page in the permission matrix (2026-09-22).

`export.task_rules` backs a new read-only page that renders the live
`export_task_rule` catalog — which shipment status opens each task, who owns it,
and what closes it.

Load-bearing, like `0039_fleet_page_perms`: `CanViewTaskRules` and the frontend
route guard both read `get_page_permissions(role).get('export.task_rules', False)`,
which is fail-closed. A registered code with no rows hides the page from EVERY
role on a database that already exists, and `seed_permissions` only runs on a
fresh install.

Seeded visible for the roles that answer "why did I get this task?" for other
people — admin / director / export_manager / document_team / boss — plus
`greenhouse_manager` and `seller`. Those two are here for the opposite reason:
they own NO `TaskRule` at all. A greenhouse manager's entire queue is the
`weekly_plan` kind and a seller's is `local_sell_plan`, both code-driven, so the
page's second table is the only place either role's work is described. Every
other role gets an explicit `is_visible=False` row so the checkbox is present and
an admin can grant it without a deploy.

`get_or_create`, not `update_or_create`: a brand-new code with no prior rows, so
there is nothing to heal, and a re-run must not stomp an admin's manual toggle.

Post-deploy verification:
    RolePagePermission.objects.filter(page_code='export.task_rules').count()
must equal 16 (one per role). If it comes back 0, this ran as a no-op against a
`test_`-prefixed database: delete the ('core', '0056_task_rules_page_perms') row
from django_migrations and re-run `migrate core` against the real database.
"""
from django.db import migrations

PAGE_CODE = 'export.task_rules'

# Mirrors ROLE_CHOICES (apps/core/models/user.py) as of 2026-09-22, including
# `quality_inspector` (core.0053). Spelled out rather than imported so a later
# role addition cannot silently change what this migration wrote — a new role is
# seeded by `seed_permissions`, not backdated here.
ALL_ROLES = (
    'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy',
    'warehouse_chief', 'weight_master', 'document_team', 'transport',
    'quality_inspector', 'sales_rep', 'finansist', 'director', 'accountant',
    'greenhouse_manager', 'seller', 'boss',
)

# The first five match what `seed_permissions` gives a non-admin page on a fresh
# database: _ALL_PAGES holds admin / director / export_manager / boss, and
# document_team copies export_manager's set. The last two are added explicitly
# in `seed_permissions` too (_TASK_RULES_EXTRA) — keep the two lists in step.
VISIBLE_ROLES = frozenset({
    'admin', 'director', 'export_manager', 'document_team', 'boss',
    'greenhouse_manager', 'seller',
})


def seed_task_rules_page(RolePagePermission) -> int:
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


def apply_task_rules_page(apps, schema_editor):
    # Gated on the connection, not on os.environ['DJANGO_TESTING'] — see the
    # long note in 0033_boss_process_visibility_perms.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    seed_task_rules_page(apps.get_model('core', 'RolePagePermission'))
    _wipe_perm_cache()


def remove_task_rules_page(apps, schema_editor):
    """Reverse: drop the rows. The page then fails closed for every role."""
    apps.get_model('core', 'RolePagePermission').objects.filter(
        page_code=PAGE_CODE,
    ).delete()
    _wipe_perm_cache()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0055_drop_quality_document_field_perms'),
    ]

    operations = [
        migrations.RunPython(apply_task_rules_page, reverse_code=remove_task_rules_page),
    ]
