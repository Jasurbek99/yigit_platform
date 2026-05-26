---
title: Data Imports
tags: [reference, data, import, management-commands]
---

# Data Import Commands

> All management commands for importing operational data from Excel/CSV into the database.

For the canonical task list see [IMPORT_TASKS.md](../IMPORT_TASKS.md).

## Import Commands

| Command | Source | Target Model | Records | Status |
|---------|--------|-------------|---------|--------|
| `seed_data` | Hardcoded | ShipmentStatusType, Country, City, ExportFirm, ImportFirm, etc. | ~200 | Done |
| `seed_block_managers` | Hardcoded | BlockManagerAssignment | ~15 | Done |
| `seed_permissions` | Registry | RolePage/Resource/FieldPermission | ~500 | Done |
| `import_reference_data` | DDL v5.1 | Core reference tables | varies | Done |
| `import_shipments` | Export_contracts.xlsx | Shipment, ShipmentStatusLog | 1,959 | Done |
| `import_prices` | Baha_Grafigi.xlsx | PriceEntry | 1,557 | Done |
| `import_domestic_prices` | _(Excel)_ | DomesticMarketPrice | varies | Done |
| `import_sales_details` | _(Excel)_ | SalesReport, ShipmentComment | varies | Done |
| `import_local_sales` | `data/quota/quota.xlsx` (sheet 2) | WeeklyLocalSellPlan | 3,008,816 kg / 273 rows | Done |
| `import_quotas` | `data/quota/quota.xlsx` (Kwota-2, rows 9-25) | QuotaIssuance, QuotaIssuanceFirmAllocation | 19 + 157 | Done |
| `import_quota_usage` | `data/quota/quota.xlsx` (Kwota-2, rows 33-108) | QuotaUsageRecord | 560 | Done |
| `cleanup_mislabeled_local_sales` | _(one-off)_ | WeeklyLocalSellPlan (delete) | 14 | Done |
| `import_weekly_plan` | _(Excel)_ | WeeklyHarvestPlan, WeeklyTruckAllocation | 318 + 173 | Done |
| `import_harvest_plans` | _(Excel)_ | WeeklyHarvestPlan | varies | Done |

## Running Imports

```bash
# All commands are in backend/apps/export/management/commands/ or backend/apps/core/management/commands/

# Example: import shipments with dry-run first
python manage.py import_shipments --dry-run
python manage.py import_shipments

# Seed commands support --reset flag
python manage.py seed_permissions --reset
```

## Quota importers (`data/quota/quota.xlsx`)

The three quota commands share `_quota_import_utils.py` (firm-name resolver + mixed-date parser) and **default to dry-run** — pass `--commit` to write. The file has three streams: issued quota (`import_quotas`), used quota (`import_quota_usage`), and daily domestic sales folded into ISO-week Mon-Sat plans (`import_local_sales`). The sales sheet labels Telekeci firms by initials (`Tel ED` = Tel Dowranow E, `Tel GJ` = Tel Gurban J #18, `Tel G Amangeldiyew` = Tel Amangeldiyew G #19); the resolver maps these correctly — an earlier version mislabeled the last two as firms #8/#13, fixed by `cleanup_mislabeled_local_sales`. See [[quota-management]] and [[local-sell-plan]].

## Import Safety Rules

- Always run `--dry-run` (or omit `--commit` for the quota importers) first when available
- All imports use `transaction.atomic()` — failure rolls back everything
- `bulk_create()` always with `batch_size=500` (MSSQL limit)
- Cargo code validation on shipment imports
- Duplicate detection via unique constraints (cargo_code, etc.)

## Source Files Location

Excel source files are in `/data/` directory (not committed to git). Key files:
- `Export_contracts_20252026.xlsx` — shipment records
- `Baha_Grafigi.xlsx` — price history
- Various operational spreadsheets for quotas, plans, sales
