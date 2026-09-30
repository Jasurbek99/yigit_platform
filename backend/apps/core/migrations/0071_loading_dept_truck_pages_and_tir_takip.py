"""Loading department gets Truck Board + Transport Plan; Tır Takip reopens (2026-09-30).

Two owner decisions from a page-permission audit:

1. loading_dept_head and loading_dept_head_deputy see `export.truck_board` and
   `transport.plan`, plus a view grant on `truck_allocation` — the Transport
   Plan page reads the week's allocation through that resource and 403s
   without it. Deputy included because seed_permissions keeps the deputy's
   pages identical to the head's (same as 0068). Before this the head could not
   see either page, so neither appeared on the head's Staff Page Access screen.
   Note: both roles hold shipment_assign edit, so on the Truck Board they can
   link and unlink trips, not only read them.

2. `tir_takip` and its nine tabs are visible again for every role except
   garawul. 0052 opened them to all roles; on the live database they had since
   been switched off for everyone but quality_inspector. garawul stays out, as
   in seed_permissions (the gate guard sees the gate screen and gate tasks only).

`update_or_create`, not the `get_or_create` of 0052/0070: the rows already exist
with is_visible=False, so a create-only seed would change nothing.

Post-deploy check:
    RolePagePermission.objects.filter(page_code='tir_takip', is_visible=True).count() == 16
If it is 0, this ran as a no-op against a `test_`-prefixed database: delete the
('core', '0071_loading_dept_truck_pages_and_tir_takip') row from
django_migrations and re-run `migrate core` against the real database.
"""
from django.db import migrations

LOADING_ROLES = ('loading_dept_head', 'loading_dept_head_deputy')
LOADING_PAGES = ('export.truck_board', 'transport.plan')

# Mirrors ROLE_CHOICES (apps/core/models/user.py) as of 2026-09-30, minus
# garawul. Spelled out rather than imported so a later role addition cannot
# silently change what this migration wrote.
TIR_TAKIP_ROLES = (
    'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy',
    'warehouse_chief', 'weight_master', 'document_team', 'transport',
    'quality_inspector', 'sales_rep', 'finansist', 'director', 'accountant',
    'greenhouse_manager', 'seller', 'boss',
)

# Frozen, like 0052 — not derived from PAGE_REGISTRY.
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


def _show(RolePagePermission, roles, pages) -> None:
    for role in roles:
        for page_code in pages:
            RolePagePermission.objects.update_or_create(
                role=role, page_code=page_code, defaults={'is_visible': True},
            )


def grant_pages(RolePagePermission, RoleResourcePermission) -> None:
    """Apply both decisions. Split out so tests can drive it directly — the
    migration itself returns early on a ``test_``-prefixed database."""
    _show(RolePagePermission, LOADING_ROLES, LOADING_PAGES)
    for role in LOADING_ROLES:
        grant, _ = RoleResourcePermission.objects.get_or_create(
            role=role, resource_code='truck_allocation',
            defaults={'can_view': True, 'can_create': False, 'can_edit': False, 'can_delete': False},
        )
        if not grant.can_view:
            grant.can_view = True
            grant.save(update_fields=['can_view'])
    _show(RolePagePermission, TIR_TAKIP_ROLES, TIR_TAKIP_PAGES)


def _wipe_perm_cache() -> None:
    """Best-effort flush of the 60 s per-role permission caches."""
    try:
        from django.core.cache import cache

        from apps.core.views_permissions import PERM_CACHE_PREFIX
        cache.delete_many(
            [f'{PERM_CACHE_PREFIX}:pages:{r}' for r in TIR_TAKIP_ROLES]
            + [f'{PERM_CACHE_PREFIX}:resources:{r}' for r in LOADING_ROLES]
        )
    except Exception:
        pass


def apply(apps, schema_editor):
    # Gated on the connection, not an env var — see core/0033 and core/0039.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    grant_pages(
        apps.get_model('core', 'RolePagePermission'),
        apps.get_model('core', 'RoleResourcePermission'),
    )
    _wipe_perm_cache()


def unapply(apps, schema_editor):
    """Reverse: hide the two pages from the loading department again. The
    truck_allocation view grant is read-only and stays; Tır Takip stays open —
    its earlier hidden state was an admin toggle no migration recorded."""
    apps.get_model('core', 'RolePagePermission').objects.filter(
        role__in=LOADING_ROLES, page_code__in=LOADING_PAGES,
    ).update(is_visible=False)
    _wipe_perm_cache()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0070_truck_board_page_perms'),
    ]

    operations = [
        migrations.RunPython(apply, reverse_code=unapply),
    ]
