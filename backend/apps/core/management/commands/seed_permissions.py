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

# Shipment Board (Kanban) — a view of the same data as export.shipments, so it
# defaults visible to every role that can already see the Shipments page.
_BOARD = 'export.shipments.board'

# Daily Harvest Board (Ýük plan we galyndy) — yesterday's remainder + today's
# plan per block. Defaults visible to every operational role that touches
# harvest/loading work (mirrors the Board breadth, plus greenhouse_manager).
_HARVEST_BOARD = 'export.harvest_board'

# Pages every authenticated role gets by default. These match the previous
# "all roles" inline lists in AppLayout / route guards (My Tasks + the three
# non-admin Feedback pages). feedback.admin_inbox is intentionally excluded —
# it stays admin-only.
_FEEDBACK_COMMON = {'feedback.submit', 'feedback.my_tickets', 'feedback.public'}
_UNIVERSAL = {'me.board'} | _FEEDBACK_COMMON

# Contracts module pages (contracts.list, contracts.sales) default to
# MANAGEMENT ONLY: admin / director / export_manager get them automatically
# because their sets are derived from _ALL_PAGES (contracts.* is not admin.*).
# No other role is granted them here — they stay hidden until an admin toggles
# them on via the permission matrix. This mirrors _CONTRACT_WRITE_ROLES.

# Pages withheld from `boss` despite the "every registered page" grant, because
# each one is DEAD or MISLEADING for him — every call behind it is refused by a
# gate that does not consult the permission matrix, so granting the page only
# produces a nav entry that fails. MUST stay identical to EXCLUDED_PAGES in
# core migration 0033_boss_process_visibility_perms.
_BOSS_DEAD_PAGES = {
    # _AdminOnlyPermission (core/views_permissions.py) rejects every method
    # including GET for non-admins per AD-15 — the whole matrix API 403s.
    'admin.permissions',
    # UserManagementViewSet.get_queryset (export/views_admin.py) raises for a
    # role that manages nobody; boss is not in MANAGEABLE_BY_ROLE.
    'admin.users',
    # ManagedPagePermissionsView (export/views_admin.py) admits full admins and
    # delegated managers only — can_manage_users(boss) is False, so GET raises.
    'admin.staff_access',
    # WORSE than a 403: FeedbackTicketViewSet.get_queryset (feedback/views.py)
    # scopes the inbox on `role == 'admin'`, so boss silently sees only his own
    # tickets. The page reads as "there is no feedback" rather than as an error.
    'feedback.admin_inbox',
}

PAGE_DEFAULTS: dict[str, set[str]] = {
    # admin: sole top-tier system administrator. Sees every page including
    # the permission matrix and admin pages. See AD-15.
    'admin': _ALL_PAGES,
    # director loses admin.* pages with AD-15 — operational role only.
    # analytics.boss, audit_log, director.stuck_shipments and the feedback pages
    # survive because their prefixes are not 'admin.'. feedback.admin_inbox is
    # removed — that inbox stays admin-only.
    'director': _ALL_PAGES - _ALL_ADMIN - {'feedback.admin_inbox'},
    # export_manager: drop the previous admin.permissions exception — AD-15
    # restricts permission-matrix CRUD to admin only. Also drop stuck-shipments
    # (director/boss oversight page) and the admin feedback inbox.
    # export.sales_rep_coverage (assign reps to customers) is a non-admin export
    # page, so export_manager inherits it from _ALL_PAGES automatically — no
    # admin.* exception needed (keeps AD-15 clean).
    'export_manager': (
        _ALL_PAGES - _ALL_ADMIN - {'director.stuck_shipments', 'feedback.admin_inbox'}
    ),
    'weight_master': {
        'dashboard', 'export.shipments', 'export.pallet_manifest', _BOARD,
        _HARVEST_BOARD,
    } | _UNIVERSAL,
    # loading_dept_head: superset of warehouse_chief (same daily work) plus
    # 'export.plan' — Soltanmyrat needs the Weekly Harvest Plan grid to coordinate
    # forecast entry (day-before + day-of until 12:00) and to read computed actuals
    # so he can plan truck loads. See harvest_day_service.set_forecast_value.
    'loading_dept_head': {
        'dashboard', 'export.shipments',
        'export.drafts',
        'export.pallet_manifest',
        'export.plan',
        _BOARD,
        _HARVEST_BOARD,
    } | _UNIVERSAL,
    'warehouse_chief': {
        'dashboard', 'export.shipments',
        # Draft workflow: warehouse_chief creates drafts (Finding #2)
        'export.drafts',
        # Pallet manifest oversight (Finding #4)
        'export.pallet_manifest',
        _BOARD,
        _HARVEST_BOARD,
    } | _UNIVERSAL,
    'document_team': {
        'dashboard', 'export.shipments', 'export.quota', _BOARD,
        _HARVEST_BOARD,
        # Documents workspace + the Contracts / Sales pages they now fully manage.
        'contracts.documents', 'contracts.list', 'contracts.sales',
        # Gross-net catalog page — pairs with the packing_template resource CRUD.
        'export.packing_presets',
    } | _UNIVERSAL,
    'transport': {
        'dashboard', 'export.shipments', _BOARD,
        _HARVEST_BOARD,
    } | _UNIVERSAL,
    'sales_rep': {
        'dashboard', 'export.shipments', 'export.advances', _BOARD,
        _HARVEST_BOARD,
        # Sales rep worklist — dedicated page for their destination-country reports.
        'export.sales_reports',
    } | _UNIVERSAL,
    'finansist': {
        'dashboard', 'export.shipments', 'export.prices', 'export.advances', _BOARD,
        _HARVEST_BOARD,
    } | _UNIVERSAL,
    'accountant': {
        'dashboard', 'export.shipments', _BOARD,
        _HARVEST_BOARD,
    } | _UNIVERSAL,
    'greenhouse_manager': {
        'dashboard', 'export.plan', 'export.domestic_sales',
        _HARVEST_BOARD,
    } | _UNIVERSAL,
    'seller': {
        'dashboard', 'export.quota.local_sell',
    } | _UNIVERSAL,
    # boss: every registered page except the four listed in
    # _BOSS_DEAD_PAGES. He owns the process end-to-end and must not need to log
    # in as another role to see a step (2026-08-05 design). _UNIVERSAL is a
    # subset of _ALL_PAGES, so nothing he had before is lost.
    'boss': _ALL_PAGES - _BOSS_DEAD_PAGES,
}

# loading_dept_head_deputy: identical page access to the head (June 2026 request).
# Copy (not a shared reference) so future in-place edits to either role's set
# don't silently mutate the other.
PAGE_DEFAULTS['loading_dept_head_deputy'] = set(PAGE_DEFAULTS['loading_dept_head'])


# ── Resource permission defaults ─────────────────────────────────────────
# Derived from roles.py constants.
# Format: {role: {resource_code: (can_view, can_create, can_edit, can_delete)}}

_VCRUD = (True, True, True, True)   # full CRUD
_VIEW = (True, False, False, False)  # read-only
_VCE = (True, True, True, False)     # view + create + edit, no delete
_VE = (True, False, True, False)     # view + edit only

_ALL_RESOURCES = set(RESOURCE_REGISTRY.keys())

RESOURCE_DEFAULTS: dict[str, dict[str, tuple[bool, bool, bool, bool]]] = {
    # admin: full CRUD on every resource (including truck_split_default),
    # EXCEPT closed_season — read-only by design (D1), overridden below.
    'admin': {
        **{r: _VCRUD for r in _ALL_RESOURCES},
        'closed_season': _VIEW,
    },
    'director': {
        **{r: _VCRUD for r in _ALL_RESOURCES},
        # sale: director may create/edit but NOT delete — sale deletion is
        # admin-only (rollback is too easy to mess up). See ContractSaleViewSet.
        'sale': _VCE,
        # closed_season: read-only by design (D1) — overrides the blanket _VCRUD.
        'closed_season': _VIEW,
    },
    'export_manager': {
        **{r: _VCRUD for r in _ALL_RESOURCES},
        # Assignment: export_manager promotes drafts to yuklenme (Finding #1)
        'shipment_assign': _VCE,
        # truck_split_default: read-only for export_manager — only the director
        # may change the official kg-per-firm constants (Gap 7 / ADR-016).
        'truck_split_default': _VIEW,
        # sale: create/edit but NOT delete — sale deletion is admin-only.
        'sale': _VCE,
        # closed_season: read-only by design (D1) — overrides the blanket _VCRUD.
        'closed_season': _VIEW,
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
        # Documents/sales/contracts are the document team's core work — full
        # operational CRUD, same level as export_manager. sale stays _VCE because
        # sale DELETE is admin-only by design (see ContractSaleViewSet); contract
        # has no such restriction.
        'contract': _VCRUD,
        'sale': _VCE,
        # packing_template: the document team builds the CMR/Invoice packets, so
        # they own the gross-net catalog they pick from — full CRUD (2026-08-27).
        'packing_template': _VCRUD,
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
        # closed_season: read-only, matches _ARCHIVE_VIEW_ROLES (export/views.py).
        'closed_season': _VIEW,
        # season: view-only, so the header season switcher (GET .../admin/seasons/,
        # gated on season.can_view via SeasonViewSet) can list seasons for
        # finansist to select — otherwise closed_season.can_view above is granted
        # but unusable (Task 15b gap). create/edit/delete stay False: season
        # close/open stays gated on season.can_edit (Task 10), which finansist
        # does not hold.
        'season': _VIEW,
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
    # boss: full CRUD on every resource. The read-only guard now lives in the
    # frontend view/edit toggle, not in the permission matrix (2026-08-05).
    # Three carve-outs, all mirrored in core migration 0033:
    'boss': {
        **{r: _VCRUD for r in _ALL_RESOURCES},
        # closed_season: read-only by design (D1), same carve-out admin has.
        'closed_season': _VIEW,
        # truck_split_default: read-only — only the director may change the
        # official kg-per-firm constants (Gap 7 / ADR-016). export_manager is
        # read-only here, so the boss must not exceed him.
        'truck_split_default': _VIEW,
        # sale: create/edit but NOT delete — sale deletion is admin-only for
        # director and export_manager too, and deleting a ContractSale re-rolls
        # the parent Contract's totals.
        'sale': _VCE,
    },
}

# loading_dept_head_deputy: identical resource permissions to the head (copied, not shared).
RESOURCE_DEFAULTS['loading_dept_head_deputy'] = dict(RESOURCE_DEFAULTS['loading_dept_head'])


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
            # Stream G: export_code is the operator-typed Export Code
            'export_code',
            'weight_net', 'weight_gross', 'box_count', 'pallet_count',
            'pallet_weight_kg', 'packaging_kg',
            'harvest_status', 'variety', 'product_type', 'loading_location',
            # R17: Soltanmyrat's freeform warehouse note
            'warehouse_note',
            # R19/R20/R21: warehouse logs loading-start, loading-end and
            # greenhouse-departure timestamps (matches warehouse_chief deputies)
            'loading_started_at',
            'loading_ended_at',
            'departed_at',
            # R34: post-loading rejected weight adjustment
            'rejected_weight_kg',
            # R39: harvest day, operator-entered
            'harvest_date',
        ],
        # R8: block sources picker (Soltanmyrat chooses which blocks supplied
        # the truck). Lives on the shipment_block_source junction resource, not
        # 'shipment' — RESOURCE_FIELDS['shipment'] never lists 'block_sources'
        # (permission_registry.py), so a grant there can never be matched by
        # the Sheet's junction-aware edit gate (can_edit_sheet_field /
        # get_sheet_edit_map, apps/core/permissions.py). Matches the
        # RoleResourcePermission grant just above.
        'shipment_block_source': ['*'],
    },
    # ── warehouse_chief (Soltanmyrat's deputies) ─────────────────────
    # Excel: R7 shipment_code (the system Shipment Code, create-only/auto), R8 blocks
    # (separate resource), R14 harvest_status, R37 weight_net, R38 weight_gross,
    # R39 variety, R20/R21 loading times (AD-1, via transition), R40 harvest
    # date (comments). Stream G: export_code (the Export Code) editable.
    'warehouse_chief': {
        'shipment': [
            # Stream G: Export Code (the operator-typed 6-field pallet tag).
            # shipment_code (the system Shipment Code) is intentionally absent — auto-generated.
            'export_code',
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
        # R8: same junction grant as loading_dept_head — "deputies and head do
        # identical day-to-day work" (see comment above the head's block).
        'shipment_block_source': ['*'],
    },
    # ── document_team (Sirin, Sulgun) ────────────────────────────────
    # Excel: R6 documents_status, R9 firm splits (separate resource),
    # R18 Shirin's notes (comments), R26 customs_exit (AD-1, via transition)
    'document_team': {
        'shipment': [
            'documents_status',
            'customs_clearance_planned_day',
            'box_count', 'pallet_count', 'weight_net', 'weight_gross',
            # Whole-truck packing config the document team picks for the CMR.
            'packing_template',
            'notes',
            # R18: Şirin's freeform document-team note
            'document_note',
            # R25: Şirin logs TM customs-exit done time (was AD-1, now operator-entered).
            'customs_exit_at',
            # R4: Şirin logs when transport dept handed docs over
            # (replaced Malik's R4 notes column per feedback #9).
            'transport_docs_given_at',
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
            # R23/R27/R28 — operator-entered plate, driver name, driver phone
            'truck_plate', 'driver_name', 'driver_phone',
            'border_point', 'transit_days', 'transport_temp_c', 'shelf_life_days',
            # R30 — Haltac logs the TM border-exit time (was AD-1, now operator-entered).
            'border_crossed_at',
            # R21 — greenhouse-departure. sheet_rows.py's default_who_key for
            # this row has been 'sheet.who.mergen' (transport) since it was
            # added; the live SheetRowSetting.role_triggers also names
            # 'transport' alongside loading_dept_head/deputy. This grant was
            # simply never added, so Mergen has been silently unable to touch
            # his own row every time loading_dept_head wasn't the one filling
            # it — masked because the loading department's own grant made the
            # cell "work" for most edits.
            'departed_at',
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
            # R31: Arap logs destination-country entry time.
            'dest_entry_at',
            # R32/R35/R41/R42 — operator-entered (were AD-1, now Sheet-driven).
            'customs_entry_at',
            'arrived_at',
            'sale_started_at',
            'sale_ended_at',
            # R44: Arap's destination-side freeform note.
            'additional_notes_arap',
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

# loading_dept_head_deputy: identical editable fields to the head (deep-copied, not shared).
FIELD_DEFAULTS['loading_dept_head_deputy'] = {
    resource: list(fields) for resource, fields in FIELD_DEFAULTS['loading_dept_head'].items()
}

# boss: wildcard on every resource. Uses a comprehension rather than admin's
# hand-enumerated list so a newly registered resource is covered automatically.
FIELD_DEFAULTS['boss'] = {r: ['*'] for r in _ALL_RESOURCES}


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

        # Clear the per-role permission caches (60 s TTL) so freshly-seeded rows
        # take effect immediately instead of after the next /auth/me/ cache miss.
        # Mirrors the admin matrix-edit endpoints, which invalidate the same keys.
        from apps.core.views_permissions import _invalidate_perm_cache
        _invalidate_perm_cache()

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
