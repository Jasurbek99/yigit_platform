"""Apply the 2026-08-05 boss process-visibility permission widening to databases
that were seeded BEFORE this branch.

`seed_permissions` uses ``get_or_create(..., defaults={...})`` and ``defaults``
applies only on INSERT. Every database seeded before this branch already holds a
``RolePagePermission`` row for every page_code on ``boss`` (all but three with
``is_visible=False``) and a view-only ``RoleResourcePermission`` row per
resource. Re-running the command finds those rows and changes nothing, so a
deploy would produce a half-applied state: the brand-new
``FIELD_DEFAULTS['boss']`` rows insert while page visibility and CRUD flags stay
exactly as they were. This migration is what actually flips them.

``update_or_create`` (not ``get_or_create``) so an existing row is corrected
rather than skipped, and a missing one is still created. Idempotent and
re-runnable. Clears the dynamic permission cache so live workers pick the change
up without a restart.

Carve-outs — keep in sync with ``PAGE_DEFAULTS['boss']`` /
``RESOURCE_DEFAULTS['boss']`` in ``seed_permissions.py``:

- ``admin.permissions`` stays hidden. ``_AdminOnlyPermission``
  (core/views_permissions.py:31-44) rejects every method including GET for
  non-admins per AD-15, so the nav entry would open a page whose every API call
  403s.
- ``closed_season`` stays read-only (D1) — a closed season stays closed for
  everyone, admin included.
- ``truck_split_default`` stays read-only — only the director may change the
  official kg-per-firm constants (Gap 7 / ADR-016). ``export_manager`` is
  read-only here, and the boss must not exceed him.
- ``sale`` loses delete — deleting a ``ContractSale`` re-rolls ``Contract``
  totals, and sale deletion is deliberately admin-only for both ``director`` and
  ``export_manager``.
"""
import os

from django.db import migrations

ROLE = 'boss'

# Pages the boss must NOT get despite the "every registered page" grant.
EXCLUDED_PAGES = ['admin.permissions']

_VCRUD = {'can_view': True, 'can_create': True, 'can_edit': True, 'can_delete': True}
_VIEW = {'can_view': True, 'can_create': False, 'can_edit': False, 'can_delete': False}
_VCE = {'can_view': True, 'can_create': True, 'can_edit': True, 'can_delete': False}

RESOURCE_OVERRIDES = {
    'closed_season': _VIEW,
    'truck_split_default': _VIEW,
    'sale': _VCE,
}

# Boss's page set before this branch (seed_permissions.py at d6f1a02) — the
# three oversight pages plus the universal My Tasks / Feedback set. Used by the
# reverse function to restore the pre-widening state exactly.
PREVIOUS_PAGES = [
    'analytics.boss',
    'analytics.clients',
    'director.stuck_shipments',
    'me.board',
    'feedback.submit',
    'feedback.my_tickets',
    'feedback.public',
]


def widen_boss_permissions(apps, schema_editor):
    # DEPLOYMENT TRAP — read before running this on a live database.
    # This early return is the repo convention (migrations 0018 / 0020 / 0026),
    # but Django still records 0033 as APPLIED when it fires. So a `migrate` run
    # with DJANGO_TESTING=true in the shell no-ops PERMANENTLY: the row lands in
    # django_migrations and a later run in the right environment will not
    # re-execute it. That matters more here than for the migrations this is
    # patterned on, because landing on a live database is this migration's whole
    # purpose, and every documented backend test command in this repo exports
    # DJANGO_TESTING=true — so the variable is routinely already set.
    # Unset it before deploying, then verify:
    #   RolePagePermission.objects.filter(role='boss', is_visible=True).count()  # -> 41
    # If it comes back 3 (or anything but 41), this ran as a no-op: delete the
    # ('core', '0033_boss_process_visibility_perms') row from django_migrations
    # and re-run `migrate core` with DJANGO_TESTING unset.
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    apply_boss_permissions(
        apps.get_model('core', 'RolePagePermission'),
        apps.get_model('core', 'RoleResourcePermission'),
        apps.get_model('core', 'RoleFieldPermission'),
    )
    _wipe_perm_cache()


def apply_boss_permissions(RolePagePermission, RoleResourcePermission, RoleFieldPermission):
    """Force every boss permission row to the 2026-08-05 target state.

    Split out of the ``RunPython`` callable so the test suite can drive it
    against a hand-built pre-state — the migration itself is a no-op under
    ``DJANGO_TESTING`` (repo convention, see migrations 0018 / 0020 / 0026).

    Args:
        RolePagePermission: the RolePagePermission model (historical or live).
        RoleResourcePermission: the RoleResourcePermission model.
        RoleFieldPermission: the RoleFieldPermission model.
    """
    # Imported lazily: permission_registry is a plain constants module with no
    # model imports, but keeping it out of migration import time avoids any
    # app-loading order surprise.
    from apps.core.permission_registry import PAGE_REGISTRY, RESOURCE_REGISTRY

    for page_code in PAGE_REGISTRY:
        RolePagePermission.objects.update_or_create(
            role=ROLE,
            page_code=page_code,
            defaults={'is_visible': page_code not in EXCLUDED_PAGES},
        )

    for resource_code in RESOURCE_REGISTRY:
        RoleResourcePermission.objects.update_or_create(
            role=ROLE,
            resource_code=resource_code,
            defaults=dict(RESOURCE_OVERRIDES.get(resource_code, _VCRUD)),
        )

    for resource_code in RESOURCE_REGISTRY:
        RoleFieldPermission.objects.get_or_create(
            role=ROLE,
            resource_code=resource_code,
            field_name='*',
        )


def narrow_boss_permissions(apps, schema_editor):
    revert_boss_permissions(
        apps.get_model('core', 'RolePagePermission'),
        apps.get_model('core', 'RoleResourcePermission'),
        apps.get_model('core', 'RoleFieldPermission'),
    )
    _wipe_perm_cache()


def revert_boss_permissions(RolePagePermission, RoleResourcePermission, RoleFieldPermission):
    """Restore the pre-widening boss state: 7 visible pages, view-only, no field rows."""
    boss_pages = RolePagePermission.objects.filter(role=ROLE)
    boss_pages.exclude(page_code__in=PREVIOUS_PAGES).update(is_visible=False)
    boss_pages.filter(page_code__in=PREVIOUS_PAGES).update(is_visible=True)

    RoleResourcePermission.objects.filter(role=ROLE).update(**_VIEW)
    RoleFieldPermission.objects.filter(role=ROLE).delete()


def _wipe_perm_cache():
    # Best-effort: clear the dynamic-permission cache so a running worker does
    # not keep serving the old boss matrix. Imported lazily — the cache helper is
    # live app code, not part of the frozen migration registry.
    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        # Never fail the migration on cache issues — a restart picks up the rows.
        pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0032_season_closed_at_season_closed_by_and_more'),
    ]

    operations = [
        migrations.RunPython(widen_boss_permissions, reverse_code=narrow_boss_permissions),
    ]
