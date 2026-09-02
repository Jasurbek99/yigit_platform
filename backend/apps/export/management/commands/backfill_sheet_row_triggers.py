"""Copy today's RoleFieldPermission grants into SheetRowSetting.role_triggers.

Sheet row triggers became the edit permission on 2026-09-02 (AD-17). Any role
that could edit a cell only through RoleFieldPermission would lose write access
once ShipmentPatchSerializer switches to the sheet gate, so every such grant is
mirrored into triggered_roles first.

Two rules that are easy to get wrong:
  - A '*' field grant expands to EVERY sheet row for that role. has_any_config
    is per row, so a wildcard role absent from one row's triggers is denied on
    that row as soon as any other role is added to it.
  - Junction rows read their own resource_code (shipment_firm_split /
    shipment_block_source), never 'shipment'.

Idempotent: get_or_create on (row, role). Safe to re-run.
"""
from django.core.management.base import BaseCommand
from django.db import transaction


def backfill() -> int:
    """Mirror field grants into row triggers. Returns the number of rows added."""
    from apps.core.models import RoleFieldPermission
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

    wildcard_roles = grants.get('shipment:*', set())

    added = 0
    with transaction.atomic():
        for field_key, setting in settings_by_key.items():
            roles: set[str] = set(wildcard_roles)

            if field_key in junction_lookup:
                resource_code, field_name = junction_lookup[field_key]
                roles |= grants.get(f'{resource_code}:{field_name}', set())
                roles |= grants.get(f'{resource_code}:*', set())
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
