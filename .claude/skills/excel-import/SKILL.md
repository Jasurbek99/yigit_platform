---
name: excel-import
description: "Write data migration scripts from Excel to DDL v5.1 database. Use when importing operational data."
---

# Excel Import Skill

## Migration script template

```python
"""
Migration: Import {description}
Source: {filename}.xlsx → Sheet: {sheet_name}
Target: {schema.table} in DDL v5.1
"""
import os, sys, django
from datetime import datetime
from decimal import Decimal, InvalidOperation

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

import openpyxl
from django.db import transaction


def parse_cargo_code(value):
    """Validate DDMM###/YY format."""
    if not value:
        return None
    code = str(value).strip()
    if '/' not in code or len(code) < 8:
        return None
    return code


def parse_decimal(value, default=Decimal('0')):
    if value is None or value == '' or value == '-':
        return default
    try:
        return Decimal(str(value).replace(',', '.').replace(' ', ''))
    except (InvalidOperation, ValueError):
        return default


def parse_date(value):
    """Handle Excel datetime objects, strings (DD.MM.YYYY, YYYY-MM-DD), and serial numbers."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, (int, float)):
        # Excel serial date
        from datetime import timedelta
        return (datetime(1899, 12, 30) + timedelta(days=int(value))).date()
    if isinstance(value, str):
        for fmt in ('%d.%m.%Y', '%Y-%m-%d', '%d/%m/%Y'):
            try:
                return datetime.strptime(value.strip(), fmt).date()
            except ValueError:
                continue
    return None


def import_data(filepath, dry_run=False):
    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active
    
    stats = {'created': 0, 'updated': 0, 'skipped': 0, 'errors': []}
    
    headers = [cell.value for cell in ws[1]]
    print(f"Headers: {headers}")
    print(f"Total rows: {ws.max_row - 1}")
    
    with transaction.atomic():
        for row in ws.iter_rows(min_row=2, values_only=False):
            row_num = row[0].row
            try:
                # Map columns to DDL v5.1 fields here
                # ...
                stats['created'] += 1
            except Exception as e:
                stats['errors'].append(f"Row {row_num}: {e}")
                if len(stats['errors']) > 50:
                    break
        
        if dry_run:
            transaction.set_rollback(True)
            print("[DRY RUN] No data written.")
    
    print(f"\nResults: {stats['created']} created, {stats['updated']} updated, {stats['skipped']} skipped")
    if stats['errors']:
        print(f"\n{len(stats['errors'])} errors:")
        for e in stats['errors'][:20]:
            print(f"  {e}")
    return stats


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('filepath')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    import_data(args.filepath, dry_run=args.dry_run)
```

## Key rules
- Always `transaction.atomic()` — rollback on error
- Always `--dry-run` flag — validate before writing
- `update_or_create` — safe for re-runs
- `batch_size=500` on any `bulk_create` (MSSQL limit)
- Parse dates flexibly — Excel stores as datetime, string, or serial number
- Cache FK lookups (firms, countries) to avoid N+1
- Validate cargo code format (`DDMM###/YY`) on every row
- Validate `weight_net_kg ≤ weight_gross_kg`
- R15 migration: old `vehicle_status_note` → `shipment_comments` with `is_system=True`
