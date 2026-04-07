"""Transfer all data from SQLite to MSSQL."""
import sqlite3
import django
import os
import sys

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import connection as mssql

SQLITE_PATH = 'db.sqlite3'

TABLE_MAP = [
    ('sys_users',                        '[dbo].[sys_users]'),
    ('core_countries',                   '[core].[countries]'),
    ('core_cities',                      '[core].[cities]'),
    ('core_border_points',               '[core].[border_points]'),
    ('core_loading_locations',           '[core].[loading_locations]'),
    ('core_tomato_varieties',            '[core].[tomato_varieties]'),
    ('core_product_types',               '[core].[product_types]'),
    ('core_seasons',                     '[core].[seasons]'),
    ('core_shipment_status_types',       '[core].[shipment_status_types]'),
    ('core_export_firms',                '[core].[export_firms]'),
    ('core_import_firms',                '[core].[import_firms]'),
    ('core_domestic_buyers',             '[core].[domestic_buyers]'),
    ('core_customers',                   '[core].[customers]'),
    ('core_greenhouse_blocks',           '[core].[greenhouse_blocks]'),
    ('export_shipments',                 '[export].[shipments]'),
    ('export_block_manager_assignments', '[export].[block_manager_assignments]'),
    ('export_shipment_firm_splits',      '[export].[shipment_firm_splits]'),
    ('token_blacklist_outstandingtoken', '[dbo].[token_blacklist_outstandingtoken]'),
    ('token_blacklist_blacklistedtoken', '[dbo].[token_blacklist_blacklistedtoken]'),
]

def transfer_table(sqlite_cur, mssql_cur, sqlite_name, mssql_name):
    sqlite_cur.execute(f'SELECT COUNT(*) FROM "{sqlite_name}"')
    count = sqlite_cur.fetchone()[0]
    if count == 0:
        print(f'  SKIP {sqlite_name} (empty)')
        return

    sqlite_cur.execute(f'SELECT * FROM "{sqlite_name}"')
    rows = sqlite_cur.fetchall()
    cols = [d[0] for d in sqlite_cur.description]
    # Django DB cursor uses %s placeholders (wraps pyodbc internally)
    placeholders = ', '.join(['%s' for _ in cols])
    col_list = ', '.join(f'[{c}]' for c in cols)

    mssql_cur.execute(f'SET IDENTITY_INSERT {mssql_name} ON')
    inserted = 0
    errors = 0
    for row in rows:
        # Convert row to list; ensure strings are proper unicode
        values = []
        for v in row:
            if isinstance(v, bytes):
                v = v.decode('utf-8', errors='replace')
            values.append(v)
        try:
            mssql_cur.execute(
                f'INSERT INTO {mssql_name} ({col_list}) VALUES ({placeholders})',
                values
            )
            inserted += 1
        except Exception as e:
            print(f'  ROW ERROR in {sqlite_name}: {str(e)[:120]}')
            errors += 1
    mssql_cur.execute(f'SET IDENTITY_INSERT {mssql_name} OFF')
    print(f'  OK {sqlite_name} -> {mssql_name}: {inserted}/{count} rows ({errors} errors)')

sqlite_conn = sqlite3.connect(SQLITE_PATH)
sqlite_conn.row_factory = None  # return tuples
sqlite_cur = sqlite_conn.cursor()

with mssql.cursor() as mssql_cur:
    for sqlite_name, mssql_name in TABLE_MAP:
        try:
            transfer_table(sqlite_cur, mssql_cur, sqlite_name, mssql_name)
        except Exception as e:
            print(f'  TABLE ERROR {sqlite_name}: {str(e)[:200]}')

sqlite_conn.close()
print('\nDone.')
