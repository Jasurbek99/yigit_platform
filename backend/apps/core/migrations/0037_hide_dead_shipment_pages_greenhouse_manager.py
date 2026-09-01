"""Hide the three dead Shipments links from `greenhouse_manager` (F6).

`greenhouse_manager` has `export.shipments`, `export.shipments_sheet` and
`export.shipments_dashboard` visible in the live matrix, but **no
`RoleResourcePermission` row for `shipment` at all** — so every endpoint behind
those three pages answers 403. Three sidebar entries that cannot work.

It is the only role in that state: every other role holding those pages also
holds `shipment.can_view`, and `seller` correctly holds neither (measured
2026-09-01).

Hiding rather than granting, because two independent sources say this role was
never meant to see shipments:

- `seed_permissions.PAGE_DEFAULTS['greenhouse_manager']` is
  `{dashboard, export.plan, export.domestic_sales, export.harvest_board}` +
  the universal four. No shipments.
- `docs/obsidian/roles/greenhouse-manager.md` — *"Pages They See: Dashboard,
  Weekly Plan Grid, Block Summary, Domestic Sales."*

The live rows are drift: `seed_permissions` only ever `get_or_create`s and never
overwrites (documented in `processes/permissions-system.md`), so it could not
heal this on its own — which is why a migration and not a re-seed.

The three splits from migration 0036 are all handled: that migration copied each
role's `export.shipments` value into the two new codes, so the drift was faithfully
tripled and all three have to be switched off together. The codes are flat
(`export.shipments_sheet`, not `export.shipments.sheet`) precisely so `canSeePage`
cannot re-open the parent from a child — see 0036.

Rows are switched to `is_visible=False` rather than deleted, so the checkbox stays
in the admin permission matrix and an owner can turn it back on deliberately (which
would also need a `shipment` resource grant to be useful).

Reversible: the reverse restores `is_visible=True`, i.e. it puts the dead links
back. That is what a rollback of this migration means.
"""
import os

from django.db import migrations

ROLE = 'greenhouse_manager'
DEAD_PAGES = (
    'export.shipments',
    'export.shipments_sheet',
    'export.shipments_dashboard',
)


def _set_visibility(RolePagePermission, is_visible: bool) -> int:
    """Flip the three page rows for the role. Returns the number of rows changed.

    Kept separate from the RunPython entry points so tests can exercise the
    actual decision without the DJANGO_TESTING guard below (which exists so a
    test database is never silently permission-seeded by a migration).
    """
    changed = RolePagePermission.objects.filter(
        role=ROLE, page_code__in=DEAD_PAGES,
    ).exclude(is_visible=is_visible).update(is_visible=is_visible)

    if changed:
        try:
            from django.core.cache import cache

            from apps.core.views_permissions import PERM_CACHE_PREFIX
            cache.delete(f'{PERM_CACHE_PREFIX}:pages:{ROLE}')
        except Exception:
            # Best-effort — the 60 s TTL expires on its own, and a worker
            # restart picks the rows up regardless.
            pass
    return changed


def hide_dead_shipment_pages(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    _set_visibility(apps.get_model('core', 'RolePagePermission'), False)


def restore_dead_shipment_pages(apps, schema_editor):
    _set_visibility(apps.get_model('core', 'RolePagePermission'), True)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0036_split_shipment_sheet_dashboard_pages'),
    ]

    operations = [
        migrations.RunPython(hide_dead_shipment_pages, reverse_code=restore_dead_shipment_pages),
    ]
