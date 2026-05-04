# Runbook — Add a new typed Sheet row (L2 schema-tier change)

This is the **deliberate developer process** for adding a new column to the
Shipment Sheet view. It's a code+migration change because the new field needs
the right Django field type, the right validator, the right input widget, and
the right cell renderer — none of which can be driven from runtime config
without losing safety. Per
[ADR-0004](../DECISIONS.md) the three-tier configuration boundary is:

- **L1 Runtime (admin via UI)** — order, lock, visibility, labels, "Who"
  override, style, permissions. ✅ already supported via Sheet Rows admin tab.
- **L2 Schema (this runbook)** — NEW `field_key`, input_type, options_source.
  Requires the 8 touches below.
- **L3 Code (developer, free-form)** — new widget types, cross-field
  validation, new options-source registries.

For runtime free-text rows that don't need typed validation, use the
**custom-row** feature in the Sheet Rows admin tab (Phase 5c) — those don't
go through this runbook.

---

## Checklist

Each step links to the canonical file and points at where the analogous
existing fields live so you can copy-by-example.

### 1. Add the model field

[backend/apps/export/models/shipment.py](../../backend/apps/export/models/shipment.py)

Pick the correct Django field type and apply the project's MSSQL rules:

| Use case | Field type | Notes |
|---|---|---|
| Short Cyrillic / Turkmen text | `CharField(max_length=N, blank=True, null=True, **cyrillic_collation())` | Spread `cyrillic_collation()` from `apps/core/db_utils` |
| Long Cyrillic text | `TextField(blank=True, null=True, **cyrillic_collation())` | |
| Money or weight | `DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)` | **Never** `FloatField` — see [.claude/rules/mssql-compat.md](../../.claude/rules/mssql-compat.md) |
| Integer count | `PositiveIntegerField(null=True, blank=True)` | |
| Date | `DateField(null=True, blank=True)` | |
| Datetime | `DateTimeField(null=True, blank=True)` | If it's an AD-1 lifecycle timestamp written only by `transition_to`, document it explicitly |
| FK to reference data | `ForeignKey('core.<Model>', on_delete=PROTECT, null=True, blank=True)` | Use the **string** form for cross-app FKs — see [.claude/rules/backend-arch.md](../../.claude/rules/backend-arch.md) |
| Choice column | `CharField(max_length=20, choices=[...], blank=True, null=True)` | |

If you also need the value to participate in serializer field renaming
(e.g. DB column is `weight_net_kg` but API exposes `weight_net`), set
`db_column='weight_net_kg'` on the field — the serializer name stays
`weight_net`.

### 2. Generate the migration

```bash
cd backend && python manage.py makemigrations export --name add_<field_name>
```

Verify the resulting migration is purely additive (an `AddField` op, maybe
`AddIndex` if you marked `db_index=True`). Reject any auto-generated
`AlterField` on unrelated columns — that's a sign your branch drifted.

### 3. Allow PATCH on the new field

[backend/apps/export/serializers.py](../../backend/apps/export/serializers.py),
~line 602 — add `field_name` to the `_ALL_PATCHABLE_FIELDS` set.

**Skip this step** if the field is one of the AD-1 lifecycle timestamps
(`departed_at`, `arrived_at`, `customs_entry_at`, etc.) — those are written
**only** by `transition_to()` and the serializer must keep refusing direct
PATCHes per [docs/ADR.md AD-1](../ADR.md).

After this step, role-based field permissions take over. The ShipmentPatch
flow already runs `validate()` against `RoleFieldPermission`, so even
patchable fields stay gated to roles you've explicitly granted.

Don't forget to grant the field via `seed_permissions` or the admin
permissions matrix — otherwise no role can edit it.

### 4. Append to DEFAULT_SHEET_ROWS

[backend/apps/export/sheet_rows.py](../../backend/apps/export/sheet_rows.py) — add an entry to the list:

```python
{
    'row_number': 45,                                 # next free integer ≥ 45 (Excel layout ends at 44)
    'field_key': 'my_new_field',                      # MUST match the model field name (or its serializer alias)
    'default_who_key': 'sheet.who.transport',         # i18n key for Col B; reuse an existing one or add a new one in step 8
    'label_key': 'sheet.row.my_new_field',            # i18n key for Col C, even though admins can override per-row
    'input_type': 'text',                             # text|number|date|datetime|dropdown|multiselect|status|comment_count|readonly
    'style': 'base',                                  # base|key|transport|status|report|separator
    'options_source': 'optional_registry_key',        # only for dropdown/multiselect — see step 6
},
```

`row_number` is informational only since Phase 1 (real ordering is
`display_order`). Picking the next free integer keeps audit logs and
cross-references with the legacy spreadsheet readable.

### 5. Cell value renderer

[frontend/src/components/sheet/SheetCell.tsx](../../frontend/src/components/sheet/SheetCell.tsx) — add a `case` to the `getCellValue()` switch. Return the formatted display string. For null show `'—'`. Examples already in the file:

- Plain text: `case 'notes': return shipment.notes ?? '—';`
- Number with locale: `case 'weight_net': return shipment.weight_net != null ? Number(shipment.weight_net).toLocaleString() : '—';`
- Datetime: handled generically by the `tsFields` array — add the field there if it's a datetime.
- Dropdown by code: `return shipment.<field> ?? '—';` (the display label is resolved separately in `SheetCellEditor`).

### 6. Cell editor (only if non-default)

[frontend/src/components/sheet/SheetCellEditor.tsx](../../frontend/src/components/sheet/SheetCellEditor.tsx). Most `input_type`s use the existing default editors at the bottom of the `render()` switch (text → `Input`, number → `InputNumber`, date → `DatePicker`, dropdown → `Select` driven by `options_source`). Only customize for special cases (firm splits, block sources, status transitions).

If you used a new `options_source` key in step 4, register it in
[frontend/src/constants/sheetOptions.ts](../../frontend/src/constants/sheetOptions.ts) so the editor can resolve labels.

### 7. TypeScript types

[frontend/src/types/index.ts](../../frontend/src/types/index.ts) — add the field to `IShipmentSheetItem` (used by the Sheet) and `IShipmentDetail` (used by the detail page + edit drawer). Match the backend serializer's exact name and nullability.

### 8. i18n

Add the row label and (if introducing a new actor identity) the "Who" key in **all three** of [frontend/src/i18n/tk.json](../../frontend/src/i18n/tk.json), [ru.json](../../frontend/src/i18n/ru.json), [en.json](../../frontend/src/i18n/en.json):

```json
{
  "sheet": {
    "row": { "my_new_field": "My new field" },
    "who": { "new_role": "New Role" }
  }
}
```

Per [.claude/rules/frontend-arch.md](../../.claude/rules/frontend-arch.md) — never copy one language's value into another's file.

### 9. (Auto) provision the SheetRowSetting

You don't need to write a data migration. The first `GET /api/v1/export/admin/sheet-rows/` after deploy idempotently creates a `SheetRowSetting` row for every entry in `DEFAULT_SHEET_ROWS` that doesn't yet have one — see
[`_provision_missing_rows`](../../backend/apps/export/views_sheet_settings.py)
in `views_sheet_settings.py`. After that, admins can override label/who/style/permissions per row from the UI.

---

## Verification

- `cd backend && python manage.py makemigrations --check --dry-run` — no surprise pending migrations beyond the one you added.
- `cd backend && python manage.py migrate` applies cleanly.
- `cd backend && python manage.py test apps.export` — full export-app suite green on MSSQL.
- `cd frontend && npm run type-check` — 0 errors.
- Manual: log in as a role with `can_edit_field('shipment', '<field>')`, open the Sheet, edit the new cell, save, refresh. Value persists.

## Common mistakes

- **`FloatField` for money or weight.** Always `DecimalField` — MSSQL float
  is approximate and breaks reconciliation against accounting.
- **Forgetting the `_ALL_PATCHABLE_FIELDS` entry.** PATCH silently drops
  unknown keys, so the row appears editable but never saves. Symptom is
  caught by [tests_shipment_field_audit.py](../../backend/apps/export/tests_shipment_field_audit.py) when a corresponding test exists.
- **Cross-app FK as a hard import** instead of `'core.<Model>'`. Breaks
  migration order. See [.claude/rules/backend-arch.md](../../.claude/rules/backend-arch.md).
- **Adding the i18n key to one locale only.** `npm run type-check` won't
  catch this — review all three JSON files manually.
- **`db_collation='Cyrillic_General_CI_AS'` missing on a Cyrillic text
  field.** Sorting and equality on Russian/Turkmen text becomes
  case-sensitive accidentally. Always spread `**cyrillic_collation()`.

## Why a runbook, not a scaffold command

A `manage.py scaffold_sheet_row` would have to template-edit 7 files —
fragile, encourages cargo-culting wrong field types. This runbook surfaces
the right type for each case and the reviewer catches mistakes (e.g. money
fields landing as FloatField). Each addition is one PR; over time the count
grows slowly and each is intentional.
