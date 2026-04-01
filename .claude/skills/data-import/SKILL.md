---
name: data-import
description: "Execute a data import task from docs/IMPORT_TASKS.md. Use when the data-importer agent needs to write and run an import command."
---

# Data Import Skill

## Checklist — run through this for every import

### 1. Read the task spec
```bash
cat /Users/macbookpro/yigit_programm/docs/IMPORT_TASKS.md
```
Find the `[ ]` task you are working on. Note: source file, sheet, target model, special rules.

### 2. Analyze the source Excel
```python
import openpyxl
wb = openpyxl.load_workbook('data/p3-export/{file}.xlsx', read_only=True, data_only=True)
print(wb.sheetnames)
ws = wb['{sheet}']
rows = list(ws.iter_rows(min_row=1, max_row=6, values_only=True))
for r in rows:
    print(r)
```

### 3. Check the target model
```bash
cat backend/apps/export/models/planning.py   # or shipment.py, etc.
```

### 4. Check existing data
```bash
USE_SQLITE=true venv/bin/python manage.py shell -c "
from apps.export.models import {Model}
print('{Model} count:', {Model}.objects.count())
"
```

### 5. Write management command
File location: `backend/apps/export/management/commands/import_{name}.py`

Must include:
- `--dry-run` flag with `transaction.set_rollback(True)`
- `batch_size=500` on all `bulk_create`
- `ignore_conflicts=True` for idempotent re-runs
- FK lookup caches (load all cities/countries/firms into dicts before the loop)
- Skip `None` / `'-'` / empty values
- Print summary: `Imported N | Skipped M | Warnings K`

### 6. Run dry-run first
```bash
cd /Users/macbookpro/yigit_programm/backend
USE_SQLITE=true venv/bin/python manage.py import_{name} --dry-run
```

### 7. Run for real
```bash
USE_SQLITE=true venv/bin/python manage.py import_{name}
```

### 8. Verify row count
```bash
USE_SQLITE=true venv/bin/python manage.py shell -c "
from apps.export.models import {Model}
print('Total {Model}:', {Model}.objects.count())
"
```

### 9. Mark task done in docs/IMPORT_TASKS.md
Change `[ ]` → `[x]` and add the row count imported.

## Parse helpers (copy into your command)

```python
from decimal import Decimal, InvalidOperation
import datetime

def parse_date(value):
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    if isinstance(value, (int, float)):
        return (datetime.datetime(1899, 12, 30) + datetime.timedelta(days=int(value))).date()
    if isinstance(value, str):
        for fmt in ('%d.%m.%Y', '%Y-%m-%d', '%d/%m/%Y'):
            try:
                return datetime.datetime.strptime(value.strip(), fmt).date()
            except ValueError:
                continue
    return None

def parse_decimal(value):
    if value is None or value == '' or str(value).strip() == '-':
        return None
    try:
        return Decimal(str(value).replace(',', '.').replace(' ', ''))
    except InvalidOperation:
        return None

def normalize_cargo_code(code: str) -> str:
    """Replace Cyrillic С with Latin C in month abbreviation."""
    return code.replace('\u0421', 'C').strip()
```
