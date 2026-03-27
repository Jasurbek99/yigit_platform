# Create Django Model

## Model: $ARGUMENTS

### Steps
1. Find the table in DDL v5.1 (`ygt_platform_ddl_v5_1.sql`) — match the exact SQL schema and column names
2. Choose app: `core/` for shared reference, `export/` for P3, `contracts/` for P4, `transport/` for P2, `finance/` for P5
3. Create the model:
   - `class Meta: db_table = 'schema.tablename'` (e.g., `'export.shipments'`)
   - `db_collation='Cyrillic_General_CI_AS'` ONLY on fields with Turkmen/Russian text
   - `DecimalField(max_digits=12, decimal_places=2)` for money/weight
   - `on_delete=models.PROTECT` for reference FKs to core/
   - Cross-app FKs: string reference `'core.ExportFirm'`
   - Trip Management FKs: `BIGINT` fields only (not Django FK, these are external tables)
4. If splitting into `models/` package: add re-export to `__init__.py`
5. Run `python manage.py makemigrations {app} && python manage.py migrate`
6. Register in `admin.py` for data inspection

### DDL issues to check
- `sys_users` → use Django `AbstractUser` extension
- `managed_blocks` column → skip, use `greenhouse_blocks.manager_id` FK
- `vehicle_status_note` → deprecated, use `vehicle_condition` + `vehicle_condition_note` + `route_note` (AD-2)
- Add AD-1 timestamp columns if creating shipment model
