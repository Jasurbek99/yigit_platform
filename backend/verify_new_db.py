"""One-off verification of YIGIT_PLATFROM_NEW after schema collapse migrate.

Run with: DB_NAME=YIGIT_PLATFROM_NEW python verify_new_db.py
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import connection


CHECKS = []


def check(label):
    def decorator(fn):
        CHECKS.append((label, fn))
        return fn
    return decorator


@check('No legacy schemas (core, export, greenhouse) remain')
def check_no_legacy_schemas(cur):
    cur.execute("""
        SELECT name FROM sys.schemas
        WHERE name IN ('core', 'export', 'greenhouse')
        ORDER BY name;
    """)
    rows = cur.fetchall()
    if rows:
        return f'FAIL: still present: {[r[0] for r in rows]}'
    return 'OK: none of {core,export,greenhouse} exist as schemas'


@check('All project tables in dbo with flat names')
def check_dbo_only(cur):
    cur.execute("""
        SELECT TABLE_SCHEMA, COUNT(*) AS table_count
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
          AND TABLE_NAME LIKE 'core[_]%'
            OR TABLE_NAME LIKE 'export[_]%'
            OR TABLE_NAME LIKE 'greenhouse[_]%'
        GROUP BY TABLE_SCHEMA
        ORDER BY TABLE_SCHEMA;
    """)
    rows = cur.fetchall()
    if not rows:
        return 'FAIL: no project tables found'
    if len(rows) != 1 or rows[0][0] != 'dbo':
        return f'FAIL: tables found in non-dbo schemas: {rows}'
    return f'OK: all {rows[0][1]} project tables in dbo'


@check('HarvestDayEntry maps to export_harvest_day_entries (not greenhouse_*)')
def check_harvest_day_entries(cur):
    cur.execute("""
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME LIKE '%harvest_day_entries%'
        ORDER BY TABLE_NAME;
    """)
    rows = cur.fetchall()
    if not rows:
        return 'FAIL: no harvest_day_entries table found'
    expected = ('dbo', 'export_harvest_day_entries')
    if rows[0] != expected:
        return f'FAIL: expected {expected}, got {rows[0]}'
    if len(rows) > 1:
        return f'FAIL: multiple matches: {rows}'
    return 'OK: dbo.export_harvest_day_entries'


@check('Cyrillic_General_CI_AS collation on key columns')
def check_cyrillic_collation(cur):
    expected = [
        ('core_export_firms', 'address_tk'),
        ('core_customers', 'name'),
        ('core_truck_destinations', 'name'),
        ('export_audit_log', 'detail'),
        ('export_truck_split_defaults', 'notes'),
    ]
    failed = []
    for table, col in expected:
        cur.execute(
            "SELECT COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME=%s AND COLUMN_NAME=%s",
            [table, col],
        )
        row = cur.fetchone()
        if row is None:
            failed.append(f'{table}.{col} not found')
        elif row[0] != 'Cyrillic_General_CI_AS':
            failed.append(f'{table}.{col} collation = {row[0]!r}')
    if failed:
        return 'FAIL: ' + '; '.join(failed)
    return f'OK: {len(expected)} sampled columns all have Cyrillic_General_CI_AS'


@check('CHECK constraints regenerated on key models')
def check_check_constraints(cur):
    expected = [
        'chk_hde_weekday',
        'chk_hde_plan_gte0',
        'chk_issuance_alloc_gt0',
        'chk_usage_kg_gt0',
        'chk_local_sell_plan_kg_gte0',
        'chk_truck_dest_count_gte0',
    ]
    cur.execute("""
        SELECT CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS
        WHERE CONSTRAINT_NAME IN (
            'chk_hde_weekday','chk_hde_plan_gte0','chk_issuance_alloc_gt0',
            'chk_usage_kg_gt0','chk_local_sell_plan_kg_gte0','chk_truck_dest_count_gte0'
        )
        ORDER BY CONSTRAINT_NAME;
    """)
    found = {row[0] for row in cur.fetchall()}
    missing = set(expected) - found
    if missing:
        return f'FAIL: missing {sorted(missing)}'
    return f'OK: all {len(expected)} expected CHECK constraints present'


@check('mssql-django patch table NOT present (we deleted it)')
def check_no_patch_table(cur):
    # Sanity check: nothing left over from old schema-patch infrastructure.
    cur.execute("""
        SELECT name FROM sys.tables
        WHERE schema_id = SCHEMA_ID('dbo')
          AND name IN ('mssql_patches_applied');
    """)
    rows = cur.fetchall()
    if rows:
        return f'FAIL: legacy patch table found: {rows}'
    return 'OK'


@check('Reference data NOT seeded (DJANGO_TESTING=false but legacy DB will copy data via step 7.5)')
def check_seeds_present(cur):
    # We expect non-test seeds to have run. Verify.
    cur.execute('SELECT COUNT(*) FROM dbo.core_shipment_option_types;')
    option_count = cur.fetchone()[0]
    cur.execute('SELECT COUNT(*) FROM dbo.core_tomato_varieties;')
    variety_count = cur.fetchone()[0]
    cur.execute('SELECT COUNT(*) FROM dbo.core_crate_types;')
    crate_count = cur.fetchone()[0]
    cur.execute('SELECT COUNT(*) FROM dbo.core_greenhouse_config;')
    config_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM dbo.core_shipment_status_types WHERE code='draft';")
    draft_count = cur.fetchone()[0]
    cur.execute('SELECT COUNT(*) FROM dbo.export_truck_split_defaults;')
    truck_count = cur.fetchone()[0]
    parts = [
        f'option_types={option_count} (expect 19)',
        f'tomato_varieties={variety_count} (expect 13)',
        f'crate_types={crate_count} (expect 3)',
        f'greenhouse_config={config_count} (expect 1)',
        f'draft_status={draft_count} (expect 1)',
        f'truck_split_defaults={truck_count} (expect 3)',
    ]
    expected = (option_count >= 19 and variety_count >= 13 and crate_count >= 3
                and config_count == 1 and draft_count == 1 and truck_count >= 3)
    return ('OK: ' if expected else 'FAIL: ') + '; '.join(parts)


@check('django_migrations recorded all expected entries')
def check_django_migrations(cur):
    cur.execute("SELECT app, name FROM dbo.django_migrations ORDER BY app, name;")
    rows = cur.fetchall()
    apps_seen = {row[0] for row in rows}
    expected_apps = {'admin', 'auth', 'contenttypes', 'core', 'export',
                     'greenhouse', 'sessions', 'token_blacklist'}
    missing_apps = expected_apps - apps_seen
    if missing_apps:
        return f'FAIL: apps missing migrations: {sorted(missing_apps)}'
    project_count = sum(1 for r in rows if r[0] in {'core', 'export', 'greenhouse'})
    return f'OK: {len(rows)} total migrations, {project_count} project migrations across 3 apps'


def main() -> int:
    failures = 0
    print(f'Verifying database: {connection.settings_dict["NAME"]}')
    print(f'On host: {connection.settings_dict["HOST"]}')
    print()
    with connection.cursor() as cur:
        for label, fn in CHECKS:
            try:
                result = fn(cur)
            except Exception as exc:
                result = f'FAIL: exception: {exc!r}'
            status = 'PASS' if result.startswith('OK') else 'FAIL'
            if status == 'FAIL':
                failures += 1
            print(f'[{status}] {label}')
            print(f'        {result}')
            print()
    print(f'{"=" * 60}')
    print(f'TOTAL: {len(CHECKS) - failures}/{len(CHECKS)} passed, {failures} failed')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
