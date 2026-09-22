"""Grant the Tır Takip pages to `quality_inspector` on existing databases.

`0054_seed_quality_inspector_perms` froze the role's page set on 2026-09-22,
before the Tır Takip branch merged. Those ten codes are handed to *every* role
by a loop at the end of `seed_permissions` — the same shape as `transport.map`,
which 0054's own comment flags as easy to miss — so a fresh install seeds them
and a database that only ever ran migrations does not. That is the drift
`tests_quality_inspector.test_migration_visible_set_matches_the_seeded_matrix`
exists to catch.

0054 stays frozen: it is already applied everywhere, and a snapshot migration
that gets edited after the fact is no longer a snapshot. This one carries the
correction forward instead.
"""

from django.db import migrations

ROLE = 'quality_inspector'


def _tir_takip_codes():
    from apps.core.permission_registry import PAGE_REGISTRY
    return sorted(
        k for k in PAGE_REGISTRY
        if k == 'tir_takip' or k.startswith('tir_takip.')
    )


def grant(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    for page_code in _tir_takip_codes():
        RolePagePermission.objects.update_or_create(
            role=ROLE, page_code=page_code, defaults={'is_visible': True},
        )


def revoke(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RolePagePermission.objects.filter(
        role=ROLE, page_code__in=_tir_takip_codes(),
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0057_merge_tir_takip_perms_and_plan_change_cap"),
    ]

    operations = [migrations.RunPython(grant, revoke)]
