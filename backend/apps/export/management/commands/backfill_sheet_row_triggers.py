"""Copy today's RoleFieldPermission + RoleResourcePermission grants into
SheetRowSetting.role_triggers.

Sheet row triggers became the edit permission on 2026-09-02 (AD-17). Any role
that could edit a cell only through RoleFieldPermission would lose write access
once ShipmentPatchSerializer switches to the sheet gate, so every such grant is
mirrored into triggered_roles first.

For the two junction rows (firm_splits / block_sources), a role can ALSO hold
write access purely via RoleResourcePermission.can_edit on the junction's own
resource (shipment_firm_split / shipment_block_source) — that was the ONLY
authority `junction_write_permission` ever read, pre-AD-17, so a role can carry
it with no matching RoleFieldPermission row at all. can_edit_sheet_fields' own
no-config fallback ORs `_has_junction_resource_grant` in for exactly this
reason, but that fallback stops firing the moment ANY role gets a trigger on
the row (has_any_config flips true for every asker, not just the triggered
role) — and the backfill itself is what puts the first trigger on the row, so
skipping the resource grant here silently drops it in production. This is not
hypothetical: a live-DB check found `document_team` holding
`shipment_block_source` at the resource level with no field grant, so it would
lose `set_block_sources` the moment this migration runs without this.

Three rules that are easy to get wrong:
  - A '*' field grant expands to EVERY sheet row for that role. has_any_config
    is per row, so a wildcard role absent from one row's triggers is denied on
    that row as soon as any other role is added to it.
  - Junction rows read their own resource_code (shipment_firm_split /
    shipment_block_source), never 'shipment' — for BOTH the field-grant lookup
    and the resource-grant lookup below.
  - RoleResourcePermission only matters for junction rows: a plain
    'shipment'.can_edit=True does not imply write access to every Sheet-owned
    field on `shipment` (that would be the AD-15 privileged bypass's job, not
    this command's), so this is not unioned in for non-junction rows.

Idempotent: get_or_create on (row, role). Safe to re-run.
"""
from django.core.management.base import BaseCommand
from django.db import transaction


def backfill() -> int:
    """Mirror field + junction resource grants into row triggers.

    Returns the number of rows added.
    """
    from apps.core.models import RoleFieldPermission, RoleResourcePermission
    from apps.core.permissions import _JUNCTION_FIELD_DELEGATES, _REVERSE_FIELD_DELEGATES
    from apps.export.models import SheetRowRoleTrigger, SheetRowSetting

    settings_by_key = {s.field_key: s for s in SheetRowSetting.objects.active()}

    # field_key → (resource_code, field_name) for the junction rows, so we ask
    # the same table the gate asks.
    junction_lookup = {
        field_key: (resource, field)
        for field_key, (resource, field) in _JUNCTION_FIELD_DELEGATES.items()
    }

    grants: dict[str, set[str]] = {}
    for role, resource_code, field_name in RoleFieldPermission.objects.values_list(
        'role', 'resource_code', 'field_name',
    ):
        grants.setdefault(f'{resource_code}:{field_name}', set()).add(role)

    # resource_code → roles holding can_edit=True on it — the pre-AD-17
    # authority for the two junction resources (see module docstring).
    resource_edit_roles: dict[str, set[str]] = {}
    for role, resource_code in RoleResourcePermission.objects.filter(
        can_edit=True,
    ).values_list('role', 'resource_code'):
        resource_edit_roles.setdefault(resource_code, set()).add(role)

    wildcard_roles = grants.get('shipment:*', set())

    added = 0
    with transaction.atomic():
        for field_key, setting in settings_by_key.items():
            roles: set[str] = set(wildcard_roles)

            if field_key in junction_lookup:
                resource_code, field_name = junction_lookup[field_key]
                roles |= grants.get(f'{resource_code}:{field_name}', set())
                roles |= grants.get(f'{resource_code}:*', set())
                roles |= resource_edit_roles.get(resource_code, set())
            else:
                roles |= grants.get(f'shipment:{field_key}', set())

            # A reverse-delegated row inherits the grants of every real column
            # it writes (packing ← box_count, pallet_count, weight_gross, ...).
            for real_field, owning_row in _REVERSE_FIELD_DELEGATES.items():
                if owning_row == field_key:
                    roles |= grants.get(f'shipment:{real_field}', set())

            for role in roles:
                _, created = SheetRowRoleTrigger.objects.get_or_create(
                    row=setting, role=role,
                )
                added += int(created)
    return added


class Command(BaseCommand):
    help = 'Mirror RoleFieldPermission grants into SheetRowSetting role triggers (AD-17).'

    def handle(self, *args, **options):
        added = backfill()
        self.stdout.write(self.style.SUCCESS(f'Added {added} role triggers.'))
