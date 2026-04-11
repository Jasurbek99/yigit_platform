"""Seed dynamic permission tables with defaults matching current hardcoded behavior.

Usage:
    python manage.py seed_permissions          # skip existing rows
    python manage.py seed_permissions --reset  # wipe and re-seed all rows

Safe to run multiple times — without --reset it only inserts missing rows.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import (
    RolePagePermission,
    RoleResourcePermission,
    RoleFieldPermission,
)
from apps.core.permission_registry import (
    PAGE_REGISTRY,
    RESOURCE_REGISTRY,
    RESOURCE_FIELDS,
)


# ── Page visibility defaults ────────────────────────────────────────────
# Maps role → set of page_codes that should be visible.
# Pages NOT listed = hidden for that role.

_ALL_PAGES = set(PAGE_REGISTRY.keys())
_ALL_EXPORT = {k for k in PAGE_REGISTRY if k.startswith('export.')}
_ALL_ADMIN = {k for k in PAGE_REGISTRY if k.startswith('admin.')}

PAGE_DEFAULTS: dict[str, set[str]] = {
    'director': _ALL_PAGES,
    'export_manager': _ALL_PAGES - _ALL_ADMIN | {'admin.permissions'},
    'warehouse_chief': {
        'dashboard', 'export.shipments', 'export.kanban',
    },
    'document_team': {
        'dashboard', 'export.shipments', 'export.kanban',
    },
    'transport': {
        'dashboard', 'export.shipments', 'export.kanban',
    },
    'sales_rep': {
        'dashboard', 'export.shipments', 'export.kanban', 'export.advances',
    },
    'finansist': {
        'dashboard', 'export.shipments', 'export.prices', 'export.advances',
    },
    'accountant': {
        'dashboard', 'export.shipments',
    },
    'greenhouse_manager': {
        'dashboard', 'export.plan', 'export.domestic_sales',
    },
    'seller': {
        'dashboard', 'export.quota.local_sell',
    },
}


# ── Resource permission defaults ─────────────────────────────────────────
# Derived from roles.py constants.
# Format: {role: {resource_code: (can_view, can_create, can_edit, can_delete)}}

_VCRUD = (True, True, True, True)   # full CRUD
_VIEW = (True, False, False, False)  # read-only
_VCE = (True, True, True, False)     # view + create + edit, no delete
_VE = (True, False, True, False)     # view + edit only

_ALL_RESOURCES = set(RESOURCE_REGISTRY.keys())

RESOURCE_DEFAULTS: dict[str, dict[str, tuple[bool, bool, bool, bool]]] = {
    'director': {r: _VCRUD for r in _ALL_RESOURCES},
    'export_manager': {r: _VCRUD for r in _ALL_RESOURCES},
    'warehouse_chief': {
        'shipment': _VE,
        'domestic_sale': _VCE,
    },
    'document_team': {
        'shipment': _VE,
    },
    'transport': {
        'shipment': _VE,
    },
    'sales_rep': {
        'shipment': _VE,
        'advance': _VIEW,
    },
    'finansist': {
        'shipment': _VE,
        'price_entry': _VCE,
        'advance': _VCRUD,
    },
    'accountant': {
        'shipment': _VIEW,
    },
    'greenhouse_manager': {
        'weekly_plan': _VCE,
        'domestic_sale': _VCE,
    },
    'seller': {
        'local_sell_plan': _VCE,
    },
}


# ── Field permission defaults ────────────────────────────────────────────
# Derived from ROLE_EDITABLE_FIELDS in permissions.py.

FIELD_DEFAULTS: dict[str, dict[str, list[str]]] = {
    'warehouse_chief': {
        'shipment': ['box_count', 'pallet_count', 'weight_net', 'weight_gross'],
    },
    'document_team': {
        'shipment': ['box_count', 'pallet_count', 'weight_net', 'weight_gross', 'notes'],
    },
    'transport': {
        'shipment': ['vehicle_condition', 'vehicle_condition_note', 'route_note'],
    },
    'sales_rep': {
        'shipment': ['price_per_kg', 'total_amount_usd'],
    },
    'finansist': {
        'shipment': ['price_per_kg', 'total_amount_usd'],
    },
    'accountant': {
        'shipment': [],
    },
    'greenhouse_manager': {
        'shipment': [],
        'weekly_plan': ['*'],
    },
    'export_manager': {
        'shipment': ['*'],
        'weekly_plan': ['*'],
        'quota_issuance': ['*'],
        'local_sell_plan': ['*'],
    },
    'director': {
        'shipment': ['*'],
        'weekly_plan': ['*'],
        'quota_issuance': ['*'],
        'local_sell_plan': ['*'],
    },
    'seller': {
        'local_sell_plan': ['planned_kg', 'actual_kg', 'buyer_name'],
    },
}


class Command(BaseCommand):
    help = 'Seed dynamic permission tables with defaults matching current hardcoded behavior'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Delete all existing permission rows before seeding',
        )

    def handle(self, *args, **options):
        reset = options['reset']

        with transaction.atomic():
            if reset:
                deleted_pages = RolePagePermission.objects.all().delete()[0]
                deleted_resources = RoleResourcePermission.objects.all().delete()[0]
                deleted_fields = RoleFieldPermission.objects.all().delete()[0]
                self.stdout.write(
                    f'Deleted {deleted_pages} page, '
                    f'{deleted_resources} resource, '
                    f'{deleted_fields} field permission rows'
                )

            self._seed_page_permissions()
            self._seed_resource_permissions()
            self._seed_field_permissions()

        self.stdout.write(self.style.SUCCESS('Permission seed complete.'))

    def _seed_page_permissions(self):
        created = 0
        for role, visible_pages in PAGE_DEFAULTS.items():
            for page_code in PAGE_REGISTRY:
                _, was_created = RolePagePermission.objects.get_or_create(
                    role=role,
                    page_code=page_code,
                    defaults={'is_visible': page_code in visible_pages},
                )
                if was_created:
                    created += 1
        self.stdout.write(f'  Page permissions: {created} rows created')

    def _seed_resource_permissions(self):
        created = 0
        for role, resources in RESOURCE_DEFAULTS.items():
            for resource_code, (v, c, e, d) in resources.items():
                _, was_created = RoleResourcePermission.objects.get_or_create(
                    role=role,
                    resource_code=resource_code,
                    defaults={
                        'can_view': v,
                        'can_create': c,
                        'can_edit': e,
                        'can_delete': d,
                    },
                )
                if was_created:
                    created += 1
        self.stdout.write(f'  Resource permissions: {created} rows created')

    def _seed_field_permissions(self):
        created = 0
        for role, resources in FIELD_DEFAULTS.items():
            for resource_code, fields in resources.items():
                for field_name in fields:
                    _, was_created = RoleFieldPermission.objects.get_or_create(
                        role=role,
                        resource_code=resource_code,
                        field_name=field_name,
                    )
                    if was_created:
                        created += 1
        self.stdout.write(f'  Field permissions: {created} rows created')
