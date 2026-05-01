"""Copy data from legacy YIGIT_PLATFROM (schema-qualified tables) to the
flat-named YIGIT_PLATFROM_NEW. Both databases are expected to live on the
same MSSQL instance — the command uses three-part naming
(``YIGIT_PLATFROM.<schema>.<table>``) and does not require a separate
Django ``legacy`` DB alias.

Run with ``DB_NAME=YIGIT_PLATFROM_NEW``:

    DB_NAME=YIGIT_PLATFROM_NEW python manage.py migrate_data_to_flat_schema
    DB_NAME=YIGIT_PLATFROM_NEW python manage.py migrate_data_to_flat_schema --dry-run
    DB_NAME=YIGIT_PLATFROM_NEW python manage.py migrate_data_to_flat_schema --only sys_users core_export_firms

The command copies in FK-dependency order (sys_users first, then the
topo-sorted list from ``docs/MIGRATION_FK_MAP.md``), preserves IDs via
``SET IDENTITY_INSERT``, and writes per-table row-count parity to
``docs/MIGRATION_ROW_COUNTS.csv``. Any mismatch fails the run with a
non-zero exit code.

Delete this command (and the ``_pre_collapse_backup/`` directory + the
``dump_fk_map`` command) once cutover is complete and the legacy DB is
dropped (step 12 of the schema collapse plan).
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction


# ---------------------------------------------------------------------------
# Table mapping: legacy (schema, table) -> new (dbo, flat_name).
# Order matters — this is a topological sort so an FK target is copied before
# any row that references it. Derived from docs/MIGRATION_FK_MAP.md (49 rows)
# with sys_users prepended (referenced by greenhouse_blocks, greenhouse_config,
# operating_day_exceptions, etc.).
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _Mapping:
    legacy_schema: str
    legacy_table: str
    new_table: str  # always under dbo

    @property
    def label(self) -> str:
        return self.new_table


_MAPPINGS: list[_Mapping] = [
    # User table (custom AbstractUser; FK target for greenhouse_blocks etc.).
    # Lives in dbo on the legacy DB (db_table='sys_users' literal, no schema).
    _Mapping('dbo', 'sys_users', 'sys_users'),

    # Order below mirrors docs/MIGRATION_FK_MAP.md "Topological copy order"
    # output of `python manage.py dump_fk_map` against the legacy DB.
    # Re-run dump_fk_map and update this list if the FK graph changes.
    _Mapping('core', 'border_points', 'core_border_points'),
    _Mapping('core', 'countries', 'core_countries'),
    _Mapping('core', 'cities', 'core_cities'),
    _Mapping('core', 'crate_types', 'core_crate_types'),
    _Mapping('core', 'customers', 'core_customers'),
    _Mapping('core', 'domestic_buyers', 'core_domestic_buyers'),
    _Mapping('core', 'export_firms', 'core_export_firms'),
    _Mapping('core', 'greenhouse_config', 'core_greenhouse_config'),
    _Mapping('core', 'import_firms', 'core_import_firms'),
    _Mapping('core', 'customer_import_firms', 'core_customer_import_firms'),
    _Mapping('core', 'loading_locations', 'core_loading_locations'),
    _Mapping('core', 'operating_day_exceptions', 'core_operating_day_exceptions'),
    _Mapping('core', 'product_types', 'core_product_types'),
    _Mapping('core', 'role_field_permissions', 'core_role_field_permissions'),
    _Mapping('core', 'role_page_permissions', 'core_role_page_permissions'),
    _Mapping('core', 'role_resource_permissions', 'core_role_resource_permissions'),
    _Mapping('core', 'seasons', 'core_seasons'),
    _Mapping('core', 'shipment_option_types', 'core_shipment_option_types'),
    _Mapping('core', 'shipment_status_types', 'core_shipment_status_types'),
    _Mapping('core', 'tomato_varieties', 'core_tomato_varieties'),
    _Mapping('core', 'greenhouse_blocks', 'core_greenhouse_blocks'),
    _Mapping('core', 'truck_destinations', 'core_truck_destinations'),
    _Mapping('export', 'audit_log', 'export_audit_log'),
    _Mapping('export', 'block_manager_assignments', 'export_block_manager_assignments'),
    _Mapping('export', 'domestic_market_prices', 'export_domestic_market_prices'),
    _Mapping('export', 'domestic_sales', 'export_domestic_sales'),
    _Mapping('export', 'finansist_advances', 'export_finansist_advances'),
    _Mapping('export', 'harvest_dispatch_log', 'export_harvest_dispatch_log'),
    _Mapping('export', 'notifications', 'export_notifications'),
    _Mapping('export', 'price_entries', 'export_price_entries'),
    _Mapping('export', 'quota_issuances', 'export_quota_issuances'),
    _Mapping('export', 'quota_issuance_firm_allocations', 'export_quota_issuance_firm_allocations'),
    _Mapping('export', 'shipments', 'export_shipments'),
    _Mapping('export', 'finansist_advance_shipments', 'export_finansist_advance_shipments'),
    _Mapping('export', 'pallets', 'export_pallets'),
    _Mapping('export', 'quality_documents', 'export_quality_documents'),
    _Mapping('export', 'quota_usage_records', 'export_quota_usage_records'),
    _Mapping('export', 'sales_reports', 'export_sales_reports'),
    _Mapping('export', 'shipment_block_sources', 'export_shipment_block_sources'),
    _Mapping('export', 'shipment_comments', 'export_shipment_comments'),
    _Mapping('export', 'shipment_firm_splits', 'export_shipment_firm_splits'),
    _Mapping('export', 'shipment_status_log', 'export_shipment_status_log'),
    _Mapping('export', 'shipments_varieties_dominant', 'export_shipments_varieties_dominant'),
    _Mapping('export', 'truck_split_defaults', 'export_truck_split_defaults'),
    _Mapping('export', 'weekly_harvest_plans', 'export_weekly_harvest_plans'),
    _Mapping('export', 'harvest_day_entries', 'export_harvest_day_entries'),
    _Mapping('export', 'weekly_local_sell_plans', 'export_weekly_local_sell_plans'),
    _Mapping('export', 'weekly_truck_allocations', 'export_weekly_truck_allocations'),
    _Mapping('export', 'truck_destination_splits', 'export_truck_destination_splits'),
]

LEGACY_DB = 'YIGIT_PLATFROM'


def _qualified_legacy(m: _Mapping) -> str:
    return f'[{LEGACY_DB}].[{m.legacy_schema}].[{m.legacy_table}]'


def _qualified_new(m: _Mapping) -> str:
    return f'[dbo].[{m.new_table}]'


def _columns_for_new_table(cur, table: str) -> list[str]:
    cur.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = %s "
        "ORDER BY ORDINAL_POSITION",
        [table],
    )
    return [r[0] for r in cur.fetchall()]


def _columns_for_legacy_table(cur, schema: str, table: str) -> set[str]:
    cur.execute(
        f"SELECT COLUMN_NAME FROM [{LEGACY_DB}].INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s",
        [schema, table],
    )
    return {r[0] for r in cur.fetchall()}


def _table_has_identity(cur, table: str) -> bool:
    cur.execute(
        "SELECT COUNT(*) FROM sys.identity_columns "
        "WHERE object_id = OBJECT_ID(%s)",
        [f'dbo.{table}'],
    )
    return cur.fetchone()[0] > 0


def _count_legacy(cur, m: _Mapping) -> int:
    cur.execute(f"SELECT COUNT(*) FROM {_qualified_legacy(m)}")
    return cur.fetchone()[0]


def _count_new(cur, m: _Mapping) -> int:
    cur.execute(f"SELECT COUNT(*) FROM {_qualified_new(m)}")
    return cur.fetchone()[0]


@dataclass
class _Result:
    table: str
    legacy_count: int
    new_count_before: int
    new_count_after: int
    delta: int
    skipped_reason: str | None = None
    error: str | None = None


class Command(BaseCommand):
    help = 'Copy data from legacy YIGIT_PLATFROM to flat-named YIGIT_PLATFROM_NEW.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report counts without copying anything.',
        )
        parser.add_argument(
            '--only', nargs='+', default=None,
            help='Restrict copy to listed flat-table names (e.g. --only sys_users core_export_firms).',
        )
        parser.add_argument(
            '--csv', default='docs/MIGRATION_ROW_COUNTS.csv',
            help='Output path for per-table row-count CSV.',
        )
        parser.add_argument(
            '--allow-overwrite', action='store_true',
            help=(
                'DELETE FROM each new table before INSERT. Required when '
                'YIGIT_PLATFROM_NEW already has rows (e.g. seeded reference '
                'data from migrations). Without this flag, the command refuses '
                'to copy into a non-empty table.'
            ),
        )

    def handle(self, *args, **opts):
        if connection.vendor != 'microsoft':
            raise CommandError(
                f'This command requires the MSSQL backend; got vendor={connection.vendor}'
            )
        if connection.settings_dict['NAME'] != 'YIGIT_PLATFROM_NEW':
            raise CommandError(
                f'Expected to be connected to YIGIT_PLATFROM_NEW; '
                f"connected to {connection.settings_dict['NAME']!r}. "
                'Set DB_NAME=YIGIT_PLATFROM_NEW.'
            )

        dry_run: bool = opts['dry_run']
        only: list[str] | None = opts['only']
        out_path = Path(opts['csv'])
        allow_overwrite: bool = opts['allow_overwrite']

        mappings = _MAPPINGS
        if only:
            wanted = set(only)
            mappings = [m for m in mappings if m.new_table in wanted]
            unknown = wanted - {m.new_table for m in _MAPPINGS}
            if unknown:
                raise CommandError(f'Unknown tables in --only: {sorted(unknown)}')

        results: list[_Result] = []
        with connection.cursor() as cur:
            for i, m in enumerate(mappings, 1):
                self.stdout.write(self.style.NOTICE(
                    f'[{i}/{len(mappings)}] {m.label}'
                ))
                try:
                    result = self._copy_one(cur, m, dry_run=dry_run, allow_overwrite=allow_overwrite)
                except Exception as exc:
                    result = _Result(
                        table=m.label, legacy_count=-1,
                        new_count_before=-1, new_count_after=-1,
                        delta=0, error=repr(exc),
                    )
                results.append(result)
                if result.error:
                    self.stdout.write(self.style.ERROR(f'    ERROR: {result.error}'))
                elif result.skipped_reason:
                    self.stdout.write(f'    skipped: {result.skipped_reason}')
                else:
                    delta_str = '' if result.delta == 0 else f' (Δ {result.delta:+})'
                    self.stdout.write(
                        f'    legacy={result.legacy_count}, new={result.new_count_after}{delta_str}'
                    )

        # Resolve out_path relative to project root (parent of backend/) when relative
        if not out_path.is_absolute():
            project_root = Path(__file__).resolve().parents[5]
            out_path = project_root / out_path
        # Always write the CSV — overwrites previous run, captures latest counts.
        if True:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with out_path.open('w', encoding='utf-8', newline='') as f:
                w = csv.writer(f)
                w.writerow(['table', 'legacy_count', 'new_count_before', 'new_count_after', 'delta', 'skipped_reason', 'error'])
                for r in results:
                    w.writerow([
                        r.table, r.legacy_count, r.new_count_before, r.new_count_after,
                        r.delta, r.skipped_reason or '', r.error or '',
                    ])
            self.stdout.write(self.style.SUCCESS(f'\nWrote {out_path}'))

        # Summary
        ok = sum(1 for r in results if not r.error and r.delta == 0)
        delta_fail = [r for r in results if not r.error and r.delta != 0]
        errors = [r for r in results if r.error]
        self.stdout.write('')
        self.stdout.write(f'  ok:           {ok}/{len(results)}')
        if delta_fail:
            self.stdout.write(self.style.ERROR(
                f'  count delta:  {len(delta_fail)} tables — {[r.table for r in delta_fail]}'
            ))
        if errors:
            self.stdout.write(self.style.ERROR(
                f'  errors:       {len(errors)} tables — {[(r.table, r.error[:80]) for r in errors]}'
            ))

        if delta_fail or errors:
            raise CommandError('Data migration completed with failures — see CSV for detail.')
        if dry_run:
            self.stdout.write(self.style.NOTICE('Dry run — no rows copied.'))
        else:
            self.stdout.write(self.style.SUCCESS('All tables copied with row-count parity.'))

    def _copy_one(self, cur, m: _Mapping, *, dry_run: bool, allow_overwrite: bool) -> _Result:
        legacy_count = _count_legacy(cur, m)
        new_count_before = _count_new(cur, m)

        if legacy_count == 0:
            # Legacy is empty — nothing to copy. If new has seeded data, leave it.
            return _Result(
                table=m.label, legacy_count=0,
                new_count_before=new_count_before, new_count_after=new_count_before,
                delta=0, skipped_reason='legacy table empty',
            )

        new_cols = _columns_for_new_table(cur, m.new_table)
        legacy_cols = _columns_for_legacy_table(cur, m.legacy_schema, m.legacy_table)
        usable_cols = [c for c in new_cols if c in legacy_cols]
        missing_in_legacy = set(new_cols) - legacy_cols
        if missing_in_legacy and not dry_run:
            # Columns present on the new schema but missing on legacy — those will
            # default to NULL/default on insert, which is correct.
            self.stdout.write(
                f'    note: columns present in new but not legacy (will default): {sorted(missing_in_legacy)}'
            )

        col_list = ', '.join(f'[{c}]' for c in usable_cols)
        has_identity = _table_has_identity(cur, m.new_table)

        if dry_run:
            # In dry-run, report the projected delta if the copy were performed.
            # delta = (legacy_count) - (legacy_count) = 0 if everything works.
            # We compute it as if the new table got cleared and refilled.
            return _Result(
                table=m.label, legacy_count=legacy_count,
                new_count_before=new_count_before, new_count_after=legacy_count,
                delta=0, skipped_reason='dry-run',
            )

        if new_count_before > 0 and not allow_overwrite:
            return _Result(
                table=m.label, legacy_count=legacy_count,
                new_count_before=new_count_before, new_count_after=new_count_before,
                delta=new_count_before - legacy_count,
                error=(
                    f'new table has {new_count_before} rows already; '
                    'pass --allow-overwrite to DELETE before INSERT'
                ),
            )

        with transaction.atomic():
            if new_count_before > 0:
                cur.execute(f'DELETE FROM {_qualified_new(m)}')
            if has_identity:
                cur.execute(f'SET IDENTITY_INSERT {_qualified_new(m)} ON')
            try:
                sql = (
                    f'INSERT INTO {_qualified_new(m)} ({col_list}) '
                    f'SELECT {col_list} FROM {_qualified_legacy(m)}'
                )
                cur.execute(sql)
            finally:
                if has_identity:
                    cur.execute(f'SET IDENTITY_INSERT {_qualified_new(m)} OFF')

        new_count_after = _count_new(cur, m)
        return _Result(
            table=m.label, legacy_count=legacy_count,
            new_count_before=new_count_before, new_count_after=new_count_after,
            delta=new_count_after - legacy_count,
        )
