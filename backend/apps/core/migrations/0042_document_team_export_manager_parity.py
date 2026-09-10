"""Clone `export_manager`'s permission matrix onto `document_team` (2026-09-09).

Stakeholder decision: the document team now carries the same authority as the
export manager on every operational gate. The code half of that lives in
`apps.core.roles.EXPORT_MANAGER_LIKE`; this migration is the data half.

`seed_permissions` cannot do it: it only ever `get_or_create`s, so on a database
that already exists every `document_team` row keeps its old, narrower value and
the new defaults are never applied. Existing installs therefore need an explicit
upsert, which is what this does.

Rows are copied FROM the live `export_manager` rows, not from a hardcoded list,
so any matrix edit an admin has already made to the export manager is reflected
in the clone rather than silently reverted.

  * Pages     — `is_visible` copied from export_manager, OR'd with whatever
                document_team already had, so nothing they hold today is lost.
  * Resources — each of the four CRUD flags takes the max of the two rows.
                document_team's existing `contract` / `packing_template` full
                CRUD therefore survives even where export_manager is narrower.
  * Fields    — export_manager's rows are added to document_team's. Where either
                side holds `'*'`, only the `'*'` row is kept and the redundant
                per-field rows for that resource are deleted.

NOT an admin alias: user/role administration and the permission matrix itself
stay admin-only per AD-15, exactly as they are for export_manager. What
document_team does gain from the clone is `admin.shipment_settings` (granting
Sheet rows to other roles), because export_manager holds it.

Irreversible as data: the pre-clone document_team grants are not snapshotted,
so `reverse` is a no-op. To undo, re-seed from the defaults:
    python manage.py seed_permissions --reset

Post-deploy verification (should print True):
    from apps.core.models import RoleResourcePermission as R
    em = {r.resource_code: (r.can_view, r.can_create, r.can_edit, r.can_delete)
          for r in R.objects.filter(role='export_manager')}
    dt = {r.resource_code: (r.can_view, r.can_create, r.can_edit, r.can_delete)
          for r in R.objects.filter(role='document_team')}
    print(all(dt.get(k, (0, 0, 0, 0)) >= v for k, v in em.items()))

If every count comes back 0, this ran against a `test_`-prefixed database:
delete the ('core', '0042_document_team_export_manager_parity') row from
django_migrations and re-run `migrate core` against the real database.
"""
import os

from django.db import migrations

SOURCE_ROLE = 'export_manager'
TARGET_ROLE = 'document_team'


def clone_export_manager(apps, schema_editor):
    if os.environ.get('DJANGO_TESTING') == 'true':
        return

    RolePagePermission = apps.get_model('core', 'RolePagePermission')
    RoleResourcePermission = apps.get_model('core', 'RoleResourcePermission')
    RoleFieldPermission = apps.get_model('core', 'RoleFieldPermission')

    # ── Pages: visible if export_manager sees it OR document_team already did ──
    target_pages = {
        row.page_code: row
        for row in RolePagePermission.objects.filter(role=TARGET_ROLE)
    }
    for src in RolePagePermission.objects.filter(role=SOURCE_ROLE):
        existing = target_pages.get(src.page_code)
        if existing is None:
            RolePagePermission.objects.create(
                role=TARGET_ROLE,
                page_code=src.page_code,
                is_visible=src.is_visible,
            )
        elif src.is_visible and not existing.is_visible:
            existing.is_visible = True
            existing.save(update_fields=['is_visible'])

    # ── Resources: max of each CRUD flag ──────────────────────────────────────
    target_resources = {
        row.resource_code: row
        for row in RoleResourcePermission.objects.filter(role=TARGET_ROLE)
    }
    for src in RoleResourcePermission.objects.filter(role=SOURCE_ROLE):
        existing = target_resources.get(src.resource_code)
        if existing is None:
            RoleResourcePermission.objects.create(
                role=TARGET_ROLE,
                resource_code=src.resource_code,
                can_view=src.can_view,
                can_create=src.can_create,
                can_edit=src.can_edit,
                can_delete=src.can_delete,
            )
            continue
        changed = []
        for flag in ('can_view', 'can_create', 'can_edit', 'can_delete'):
            if getattr(src, flag) and not getattr(existing, flag):
                setattr(existing, flag, True)
                changed.append(flag)
        if changed:
            existing.save(update_fields=changed)

    # ── Fields: add export_manager's rows; '*' collapses the rest ─────────────
    target_fields = set(
        RoleFieldPermission.objects.filter(role=TARGET_ROLE)
        .values_list('resource_code', 'field_name')
    )
    for src in RoleFieldPermission.objects.filter(role=SOURCE_ROLE):
        key = (src.resource_code, src.field_name)
        if key in target_fields:
            continue
        RoleFieldPermission.objects.create(
            role=TARGET_ROLE,
            resource_code=src.resource_code,
            field_name=src.field_name,
        )
        target_fields.add(key)

    wildcard_resources = {
        resource for resource, field in target_fields if field == '*'
    }
    if wildcard_resources:
        RoleFieldPermission.objects.filter(
            role=TARGET_ROLE, resource_code__in=sorted(wildcard_resources),
        ).exclude(field_name='*').delete()

    try:
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()
    except Exception:
        # Cache wipe is best-effort — the 60 s TTL expires on its own.
        pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0041_documents_status_single_ready_option'),
    ]

    operations = [
        migrations.RunPython(clone_export_manager, reverse_code=migrations.RunPython.noop),
    ]
