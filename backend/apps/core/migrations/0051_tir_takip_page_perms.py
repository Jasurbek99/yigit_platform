"""Register the Tır Takip page and its nine tabs in the permission matrix (2026-09-16).

`tir_takip` is a tab shell (Maşyn Yzarlamasy) with no content of its own. Each
tab carries its own code so an admin can grant or revoke a single tab from the
permission screen without a deploy — the owner's requirement was "open to every
role now, configurable later", and configurable means matrix rows.

This migration is load-bearing. `get_page_permissions(role).get(code, False)` is
fail-closed, so a code that is registered in PAGE_REGISTRY but has no rows hides
the page from EVERY role on a database that already exists. `seed_permissions`
cannot cover it — it only ever `get_or_create`s, and it is not re-run on deploy.

Every role gets every code visible, matching the seed defaults (`_TIR_TAKIP` in
seed_permissions.py). Nothing is withheld: on the day this deploys, the page and
all nine tabs are open to all 15 roles, and the first revoke is an admin's
checkbox rather than a code change.

`get_or_create`, not `update_or_create`: these are brand-new codes with no prior
rows, so there is nothing to heal, and a re-run must not stomp an admin's manual
toggle.

Post-deploy verification:
    RolePagePermission.objects.filter(page_code__startswith='tir_takip').count()
must equal 150 (15 roles x 10 codes). If it comes back 0, this ran as a no-op
against a `test_`-prefixed database: delete the ('core', '0051_tir_takip_page_perms')
row from django_migrations and re-run `migrate core` against the real database.
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

# Frozen at the shape this migration wrote. Deliberately NOT derived from
# PAGE_REGISTRY: a tab added to the registry later needs its own migration, so
# that a re-run of this one can never backfill rows nobody reviewed.
TIR_TAKIP_PAGES = (
    'tir_takip',
    'tir_takip.onumcilik',
    'tir_takip.gaplama',
    'tir_takip.tirlar',
    'tir_takip.export_rapor',
    'tir_takip.hasabat',
    'tir_takip.gumruk_ewrak',
    'tir_takip.kwota_takibi',
    'tir_takip.sertnamalar',
    'tir_takip.datalar',
)


def seed_tir_takip_pages(RolePagePermission) -> int:
    """Create the missing rows. Returns how many were created.

    Split out of the RunPython callable so tests can drive it directly — the
    migration itself returns early on a ``test_``-prefixed database.
    """
    created = 0
    for page_code in TIR_TAKIP_PAGES:
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


def apply_tir_takip_pages(apps, schema_editor):
    # Gated on the connection, not on os.environ['DJANGO_TESTING'] — see the
    # long note in 0033_boss_process_visibility_perms: Django records a
    # migration as applied whether or not its body ran, so an environment
    # variable left set in the shell would no-op this permanently and every
    # role would lose the page with no way to notice.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    seed_tir_takip_pages(apps.get_model('core', 'RolePagePermission'))
    _wipe_perm_cache()


def remove_tir_takip_pages(apps, schema_editor):
    """Reverse: drop the rows. The page then fails closed for every role."""
    apps.get_model('core', 'RolePagePermission').objects.filter(
        page_code__in=TIR_TAKIP_PAGES,
    ).delete()
    _wipe_perm_cache()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0050_seed_border_point_ru_names'),
    ]

    operations = [
        migrations.RunPython(apply_tir_takip_pages, reverse_code=remove_tir_takip_pages),
    ]
