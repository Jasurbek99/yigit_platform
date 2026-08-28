"""Give the Shipment Sheet and the Shipment Dashboard their own page codes.

Both routes used to resolve to `export.shipments` in the frontend's
ROUTE_PAGE_MAP, so the permission matrix had a single "Shipments" checkbox that
turned the list, the sheet and the dashboard on together — there was no way to
hide one view without hiding all three.

They are now `export.shipments_sheet` and `export.shipments_dashboard`. Flat
codes, NOT `export.shipments.sheet`: `canSeePage` (frontend/src/utils/permissions.ts)
grants a parent page whenever any child code is visible, so the nested form would
silently re-open the Shipments list for anyone granted only the sheet — a
checkbox that cannot do what it says. `export.shipments.board` keeps the nested
form and its latent version of that quirk; this migration does not touch it.

Backfill copies `is_visible` PER ROW from each role's existing `export.shipments`
row rather than seeding from PAGE_DEFAULTS, because the live matrix has been
hand-edited by admins. Result: nobody gains or loses access on deploy — the split
starts as a faithful copy and admins diverge the three codes from there.

Deploy order matters: this must be applied BEFORE the new frontend bundle is
served, otherwise `/export/shipments/sheet` resolves to a code no row exists for
and the Sheet disappears for everyone.

Idempotent: get_or_create on the (role, page_code) unique key. Re-runnable.
Clears the page-permission cache for every role that has rows so live workers
pick the new codes up without a restart.
"""
import os

from django.db import migrations


PARENT = 'export.shipments'
NEW_CODES = ('export.shipments_sheet', 'export.shipments_dashboard')


def split_shipment_pages(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return
    RolePagePermission = apps.get_model('core', 'RolePagePermission')

    parents = RolePagePermission.objects.filter(page_code=PARENT).values(
        'role', 'is_visible',
    )
    roles = []
    for parent in parents:
        roles.append(parent['role'])
        for code in NEW_CODES:
            RolePagePermission.objects.get_or_create(
                role=parent['role'],
                page_code=code,
                defaults={'is_visible': parent['is_visible']},
            )

    try:
        from django.core.cache import cache
        from apps.core.views_permissions import PERM_CACHE_PREFIX
        cache.delete_many([f'{PERM_CACHE_PREFIX}:pages:{role}' for role in roles])
    except Exception:
        # Cache wipe is best-effort — a worker restart picks up the rows anyway.
        pass


def merge_shipment_pages(apps, schema_editor):
    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RolePagePermission.objects.filter(page_code__in=NEW_CODES).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0035_grant_packing_template_document_team'),
    ]

    operations = [
        migrations.RunPython(split_shipment_pages, reverse_code=merge_shipment_pages),
    ]
