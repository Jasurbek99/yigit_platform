"""Grant the new `fleet` resource so fleet writes are editable in the matrix (2026-09-03).

Follow-up to `0039_fleet_page_perms`, which put the two fleet **pages** on the
permission screen. Fleet writes (truck heads, trailers, drivers) were still
gated on the `transport.fleet` *page* row, so the Resources tab had nothing for
the fleet at all — the screen showed who may SEE the page but not who may EDIT
the catalog, which is where every other admin screen's write permission lives.

`CanEditFleet` now reads the `fleet` resource (`resource_write_permission`), so
this migration is load-bearing exactly the way 0039 was: the gate is
fail-closed, and `seed_permissions` only ever `get_or_create`s and is not run on
deploy, so without these rows every non-superuser would lose fleet editing the
moment the bundle ships.

Rows reproduce the previous gate exactly — the old hardcoded
`SHIPMENT_EDITOR_ROLES` set: `admin`, `director`, `export_manager`, `boss`,
`warehouse_chief`, `loading_dept_head`, `loading_dept_head_deputy`. `boss` needs
his row written here for the same reason as in `0038`: the blanket
`**{r: _VCRUD for r in _ALL_RESOURCES}` wildcard only fires when
`seed_permissions` runs, and the earlier boss-widening migration (`0033`)
enumerated `RESOURCE_REGISTRY` as it stood then, which had no `fleet`.

`can_delete=False` for everyone: none of the three fleet ViewSets expose
`destroy` (`Shipment.driver_id` is a loose integer with no FK, so rows are
deactivated, not removed). Roles outside the list get **no row**, which
`resource_write_permission` reads as "no writes" — same shape as `0035`'s
packing-template grant, and it leaves the Resources tab checkbox unticked
rather than pre-writing a row an admin never asked for.

`get_or_create`, so a re-run cannot stomp an admin's toggle.

Post-deploy verification:
    RoleResourcePermission.objects.filter(resource_code='fleet').count()
must equal 7. If it comes back 0, this ran as a no-op against a `test_`-prefixed
database: delete the ('core', '0040_fleet_resource') row from django_migrations
and re-run `migrate core` against the real database.
"""
from django.db import migrations

ROLES = (
    'admin', 'director', 'export_manager', 'boss',
    'warehouse_chief', 'loading_dept_head', 'loading_dept_head_deputy',
)

RESOURCE = 'fleet'

# view + create + edit, no delete — there is no destroy action to gate.
GRANT = {'can_view': True, 'can_create': True, 'can_edit': True, 'can_delete': False}


def grant_fleet_resource(RoleResourcePermission) -> int:
    """Create the missing rows. Returns how many were created.

    Split out of the RunPython callable so tests can drive it directly — the
    migration itself returns early on a ``test_``-prefixed database.
    """
    created = 0
    for role in ROLES:
        _, was_created = RoleResourcePermission.objects.get_or_create(
            role=role, resource_code=RESOURCE, defaults=dict(GRANT),
        )
        created += int(was_created)
    return created


def _wipe_perm_cache() -> None:
    """Best-effort flush of the 60 s per-role resource caches."""
    try:
        from django.core.cache import cache

        from apps.core.views_permissions import PERM_CACHE_PREFIX
        keys = [f'{PERM_CACHE_PREFIX}:resources:{r}' for r in ROLES]
        keys += [f'{PERM_CACHE_PREFIX}:resource:{r}:{RESOURCE}' for r in ROLES]
        cache.delete_many(keys)
    except Exception:
        pass


def apply_fleet_resource(apps, schema_editor):
    # Gated on the connection, not on os.environ['DJANGO_TESTING'] — see the
    # long note in 0033_boss_process_visibility_perms.
    if schema_editor.connection.settings_dict['NAME'].startswith('test_'):
        return
    grant_fleet_resource(apps.get_model('core', 'RoleResourcePermission'))
    _wipe_perm_cache()


def remove_fleet_resource(apps, schema_editor):
    """Reverse: drop the rows. Fleet writes then fail closed for every role."""
    apps.get_model('core', 'RoleResourcePermission').objects.filter(
        resource_code=RESOURCE,
    ).delete()
    _wipe_perm_cache()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0039_fleet_page_perms'),
    ]

    operations = [
        migrations.RunPython(apply_fleet_resource, reverse_code=remove_fleet_resource),
    ]
