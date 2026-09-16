"""Register Work Hours and Team Leaderboard in the permission matrix (2026-09-16).

`/worklog` (Work Hours) and `/team/kpi` (Team Leaderboard) were open to every
authenticated user through hardcoded 15-role arrays in `AppLayout.tsx` and a
bare `<ProtectedRoute>` in `App.tsx`, so neither page appeared on the admin
permission screen or on Staff Page Access, and neither could be revoked.

Both codes (`worklog`, `team_kpi`) are now in `PAGE_REGISTRY`. That makes this
migration load-bearing: `get_page_permissions(role).get(code, False)` is
fail-closed, so a registered code with no rows hides the page from EVERY role
on a database that already exists. `seed_permissions` cannot cover it — it
only ever `get_or_create`s, and it is not re-run on deploy.

Every role gets `is_visible=True`, reproducing the old "everyone sees it"
behaviour (ADR "radical transparency"), so nobody's access changes on this
deploy. What changes is that an admin can now untick either page per role.

`get_or_create`, not `update_or_create`: brand-new codes with no prior rows, so
a re-run must not stomp an admin's manual toggle.

Named apart from `Copy_Gadams_UI`'s `0051_tir_takip_page_perms` (applied to the
shared MSSQL). Merging that branch leaves two 0051 leaves — add a merge
migration then.

Post-deploy verification:
    RolePagePermission.objects.filter(page_code__in=['worklog', 'team_kpi']).count()
must equal 30 (15 roles x 2 codes). If it comes back 0, this ran as a no-op
against a `test_`-prefixed database: delete the
('core', '0051_worklog_team_kpi_page_perms') row from django_migrations and
re-run `migrate core` against the real database.
"""
from django.db import migrations

# Mirrors ROLE_CHOICES (apps/core/models/user.py) as of 2026-09-16. Spelled out
# rather than imported so a later role addition cannot silently change what this
# migration wrote — a new role is seeded by `seed_permissions`, not backdated here.
ALL_ROLES = (
    'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy',
    'warehouse_chief', 'weight_master', 'document_team', 'transport',
    'sales_rep', 'finansist', 'director', 'accountant', 'greenhouse_manager',
    'seller', 'boss',
)

PAGES = ('worklog', 'team_kpi')


def seed_team_pages(RolePagePermission) -> int:
    """Create the missing rows. Returns how many were created.

    Split out of the RunPython callable so tests can drive it directly — the
    migration itself returns early on a ``test_``-prefixed database.
    """
    created = 0
    for page_code in PAGES:
        for role in ALL_ROLES:
            _, was_created = RolePagePermission.objects.get_or_create(
                role=role,
                page_code=page_code,
                defaults={'is_visible': True},
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


def apply_team_pages(apps, schema_editor):
    # Gated on the connection, not on os.environ['DJANGO_TESTING'] — see
    # 0033_boss_process_visibility_perms for why.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    seed_team_pages(apps.get_model('core', 'RolePagePermission'))
    _wipe_perm_cache()


def remove_team_pages(apps, schema_editor):
    """Reverse: drop the rows. The pages then fail closed for every role."""
    apps.get_model('core', 'RolePagePermission').objects.filter(
        page_code__in=PAGES,
    ).delete()
    _wipe_perm_cache()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0050_seed_border_point_ru_names'),
    ]

    operations = [
        migrations.RunPython(apply_team_pages, reverse_code=remove_team_pages),
    ]
