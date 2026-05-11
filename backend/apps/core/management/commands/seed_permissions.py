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
    # admin: sole top-tier system administrator. Sees every page including
    # the permission matrix and admin pages. See AD-15.
    'admin': _ALL_PAGES,
    # director loses admin.* pages with AD-15 — operational role only.
    # analytics.boss survives because its prefix is 'analytics.', not 'admin.'.
    'director': _ALL_PAGES - _ALL_ADMIN,
    # export_manager: drop the previous admin.permissions exception — AD-15
    # restricts permission-matrix CRUD to admin only.
    'export_manager': _ALL_PAGES - _ALL_ADMIN,
    'weight_master': {
        'dashboard', 'export.shipments', 'export.pallet_manifest',
    },
    # loading_dept_head: superset of warehouse_chief (same daily work) plus
    # 'export.plan' — Soltanmyrat needs the Weekly Harvest Plan grid to coordinate
    # forecast entry (day-before + day-of until 12:00) and to read computed actuals
    # so he can plan truck loads. See harvest_day_service.set_forecast_value.
    'loading_dept_head': {
        'dashboard', 'export.shipments',
        'export.drafts',
        'export.pallet_manifest',
        'export.plan',
    },
    'warehouse_chief': {
        'dashboard', 'export.shipments',
        # Draft workflow: warehouse_chief creates drafts (Finding #2)
        'export.drafts',
        # Pallet manifest oversight (Finding #4)
        'export.pallet_manifest',
    },
    'document_team': {
        'dashboard', 'export.shipments', 'export.quota',
    },
    'transport': {
        'dashboard', 'export.shipments',
    },
    'sales_rep': {
        'dashboard', 'export.shipments', 'export.advances',
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
    # Boss is strictly executive: only the analytics dashboard is visible.
    # All other navigation hidden so the role lands exclusively on /boss/dashboard.
    'boss': {
        'analytics.boss',
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
    # admin: full CRUD on every resource (including truck_split_default).
    'admin': {r: _VCRUD for r in _ALL_RESOURCES},
    'director': {r: _VCRUD for r in _ALL_RESOURCES},
    'export_manager': {
        **{r: _VCRUD for r in _ALL_RESOURCES},
        # Assignment: export_manager promotes drafts to yuklenme (Finding #1)
        'shipment_assign': _VCE,
        # truck_split_default: read-only for export_manager — only the director
        # may change the official kg-per-firm constants (Gap 7 / ADR-016).
        'truck_split_default': _VIEW,
    },
    'weight_master': {
        'shipment': _VIEW,                              # can view but not edit shipment proper
        'pallet': _VCRUD,                               # full CRUD on own pallets
        'manifest_close': (True, True, False, False),   # can trigger close
        'shipment_comment': _VCE,
    },
    # loading_dept_head: same resource permissions as warehouse_chief. Org-chart
    # difference (he heads the dept, deputies report to him) is structural; both
    # do identical day-to-day work per stakeholder feedback (Kaka Findings #5).
    'loading_dept_head': {
        'shipment': _VCE,
        'shipment_block_source': _VCE,
        'shipment_comment': _VCE,
        'domestic_sale': _VCE,
        'pallet': _VE,
        'manifest_close': _VE,
    },
    'warehouse_chief': {
        # _VCE: warehouse_chief can now create draft shipments (Finding #2)
        'shipment': _VCE,
        'shipment_block_source': _VCE,   # Soltanmyrat creates block sources
        'shipment_comment': _VCE,
        'domestic_sale': _VCE,
        'pallet': _VE,                   # view + edit; can override but not create
        'manifest_close': _VE,           # view + trigger close
    },
    'document_team': {
        'shipment': _VE,
        'shipment_firm_split': _VCE,     # Sulgun manages firm splits
        'quality_document': _VCE,
        'shipment_comment': _VCE,
        'quota_issuance': _VCE,
        'quota_usage': _VCE,
    },
    'transport': {
        'shipment': _VE,
        'shipment_comment': _VCE,
    },
    'sales_rep': {
        'shipment': _VE,
        'sales_report': _VCE,           # Arap creates sales reports
        'shipment_comment': _VCE,
        'advance': _VIEW,
    },
    'finansist': {
        'shipment': _VE,
        'shipment_comment': _VCE,
        'price_entry': _VCE,
        'advance': _VCRUD,
    },
    'accountant': {
        'shipment': _VIEW,
        'sales_report': _VIEW,
    },
    'greenhouse_manager': {
        'weekly_plan': _VCE,
        'domestic_sale': _VCE,
    },
    'seller': {
        'local_sell_plan': _VCE,
    },
    # Boss is strictly read-only across every resource — never edits.
    'boss': {r: _VIEW for r in _ALL_RESOURCES},
}


# ── Field permission defaults ────────────────────────────────────────────
# Source of truth for RoleFieldPermission rows.

FIELD_DEFAULTS: dict[str, dict[str, list[str]]] = {
    # ── admin (sole system administrator) ─────────────────────────────
    # Wildcard on every resource — admin must be able to fix anything.
    'admin': {
        'shipment': ['*'],
        'shipment_firm_split': ['*'],
        'shipment_block_source': ['*'],
        'quality_document': ['*'],
        'sales_report': ['*'],
        'weekly_plan': ['*'],
        'quota_issuance': ['*'],
        'local_sell_plan': ['*'],
    },
    # ── loading_dept_head (Soltanmyrat, Kaka) ────────────────────────
    # Same editable fields as warehouse_chief — deputies and head do identical
    # day-to-day work per stakeholder feedback (Kaka Findings #5).
    'loading_dept_head': {
        'shipment': [
            # Stream G: official_export_code is the operator-entered Shipment Code
            'official_export_code',
            'weight_net', 'weight_gross', 'box_count', 'pallet_count',
            'pallet_weight_kg', 'packaging_kg',
            'harvest_status', 'variety', 'product_type', 'loading_location',
            # R17: Soltanmyrat's freeform warehouse note
            'warehouse_note',
        ],
    },
    # ── warehouse_chief (Soltanmyrat's deputies) ─────────────────────
    # Excel: R7 cargo_code (Export Code, create-only/auto), R8 blocks
    # (separate resource), R14 harvest_status, R37 weight_net, R38 weight_gross,
    # R39 variety, R20/R21 loading times (AD-1, via transition), R40 harvest
    # date (comments). Stream G: official_export_code (Shipment Code) editable.
    'warehouse_chief': {
        'shipment': [
            # Stream G: Shipment Code (the official 6-field pallet tag).
            # cargo_code (Export Code) is intentionally absent — auto-generated.
            'official_export_code',
            'weight_net', 'weight_gross', 'box_count', 'pallet_count',
            'pallet_weight_kg', 'packaging_kg',
            'harvest_status', 'variety', 'product_type', 'loading_location',
            # R19/R20/R21: warehouse logs the truck's loading-start, loading-end
            # and greenhouse-departure timestamps (NOT AD-1 — operator-entered).
            'loading_started_at',
            'loading_ended_at',
            'departed_at',
            # R39: harvest day, operator-entered.
            'harvest_date',
            # R17: Soltanmyrat's freeform warehouse note (deputies share the field)
            'warehouse_note',
        ],
    },
    # ── document_team (Sirin, Sulgun) ────────────────────────────────
    # Excel: R6 documents_status, R9 firm splits (separate resource),
    # R18 Shirin's notes (comments), R26 customs_exit (AD-1, via transition)
    'document_team': {
        'shipment': [
            'documents_status',
            'customs_clearance_planned_day',
            'box_count', 'pallet_count', 'weight_net', 'weight_gross',
            'notes',
            # R18: Şirin's freeform document-team note
            'document_note',
        ],
        'shipment_firm_split': ['*'],
        'quality_document': ['*'],
        'quota_issuance': ['*'],
        'quota_usage': ['*'],
    },
    # ── transport (Haltac, Malik, Transport bölüm, Hil Gözegçi) ─────
    # Excel: R15 vehicle status, R23 responsible, R24 truck/trailer,
    # R28 driver, R29 driver phone (via driver FK), R30 border point,
    # R27 transit days + temp (quality inspector)
    # R31 border exit time (AD-1, via transition)
    'transport': {
        'shipment': [
            'vehicle_condition', 'vehicle_condition_note',
            'vehicle_live_status',
            'vehicle_responsible', 'truck_head_id', 'trailer_id', 'driver_id',
            'border_point', 'transit_days', 'transport_temp_c', 'shelf_life_days',
        ],
    },
    # ── sales_rep (Arap, Aganazar) ───────────────────────────────────
    # Excel: R12 city, R33 peregruz, R34 peregruz time, R35 arrival (AD-1),
    # R42 sale start (AD-1), R43 sale end (AD-1), R44 report (separate resource)
    'sales_rep': {
        'shipment': [
            'city', 'has_peregruz', 'peregruz_city', 'peregruz_date',
            'rejected_weight_kg', 'price_per_kg', 'total_amount_usd',
            # R43: Aganazar logs the date the sales report was filed.
            'sales_report_date',
        ],
        'sales_report': ['*'],
    },
    # ── finansist (Babageldi) ────────────────────────────────────────
    # Excel: R25 cash advance (separate resource)
    'finansist': {
        'shipment': ['price_per_kg', 'total_amount_usd'],
        'advance': ['*'],
    },
    # ── accountant ───────────────────────────────────────────────────
    'accountant': {
        'shipment': [],
    },
    # ── greenhouse_manager ───────────────────────────────────────────
    'greenhouse_manager': {
        'shipment': [],
        'weekly_plan': ['*'],
    },
    # ── export_manager (Gadam J) ─────────────────────────────────────
    # R5 export_manager_note (owned), R10 country, R11 customer, R13 import_firm
    # Wildcard: can edit all shipment fields + manage all related resources
    'export_manager': {
        'shipment': ['*'],
        'shipment_firm_split': ['*'],
        'shipment_block_source': ['*'],
        'quality_document': ['*'],
        'sales_report': ['*'],
        'weekly_plan': ['*'],
        'quota_issuance': ['*'],
        'local_sell_plan': ['*'],
    },
    # ── director ─────────────────────────────────────────────────────
    'director': {
        'shipment': ['*'],
        'shipment_firm_split': ['*'],
        'shipment_block_source': ['*'],
        'quality_document': ['*'],
        'sales_report': ['*'],
        'weekly_plan': ['*'],
        'quota_issuance': ['*'],
        'local_sell_plan': ['*'],
    },
    # ── seller ───────────────────────────────────────────────────────
    'seller': {
        'local_sell_plan': ['planned_kg', 'actual_kg', 'buyer_name'],
    },
    # ── weight_master (Artykow Maksat, Kaka) ─────────────────────────
    # Full pallet manifest CRUD; read-only on the shipment header itself.
    'weight_master': {
        'shipment': [],  # no field edits on shipment proper
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

        # Warn about roles missing from defaults
        from apps.core.models.user import ROLE_CHOICES
        all_roles = {r[0] for r in ROLE_CHOICES}
        missing_page = all_roles - set(PAGE_DEFAULTS.keys())
        missing_resource = all_roles - set(RESOURCE_DEFAULTS.keys())
        if missing_page:
            self.stderr.write(self.style.WARNING(
                f'WARNING: roles missing from PAGE_DEFAULTS (will get no page access): {sorted(missing_page)}'
            ))
        if missing_resource:
            self.stderr.write(self.style.WARNING(
                f'WARNING: roles missing from RESOURCE_DEFAULTS (will get no resource access): {sorted(missing_resource)}'
            ))

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
