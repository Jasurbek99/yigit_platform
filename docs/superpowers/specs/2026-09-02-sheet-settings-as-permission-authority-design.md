# Sheet Settings as the Permission Authority

Date: 2026-09-02
Status: Draft — awaiting user approval

## Problem

Deciding "may this role edit this Sheet cell?" today requires agreement between
two tables that nothing keeps in sync:

- `SheetRowSetting.role_triggers` — edited in **Admin → Shipment Settings**
- `RoleFieldPermission` — edited in **Admin → Permissions**

`can_edit_sheet_field` (`apps/core/permissions.py:301`) AND-composes them, so
granting a role in Shipment Settings has no effect until someone also ticks the
field in the Permissions admin. That is the reported bug: `document_team` was
added to the `country` / `import_firm` rows and still could not edit them,
because `FIELD_DEFAULTS['document_team']['shipment']`
(`seed_permissions.py:391`) does not list those fields.

Two aggravating facts found while investigating:

1. **The Sheet's real write gate ignores `role_triggers` entirely.**
   `PATCH /shipments/{id}/` validates through `ShipmentPatchSerializer.validate`
   (`apps/export/serializers.py:1549`), which calls `can_edit_field` — the
   `RoleFieldPermission` table alone. `can_edit_sheet_field` only gates the
   display map, field-history, swap, bulk-ops and custom fields. So the
   Shipment Settings screen never controlled the actual write.
2. **`/admin/sheet-rows/` is gated on `shipment.can_edit`**
   (`views_sheet_settings.py:274`) — held by `document_team`, `transport`,
   `sales_rep`, `finansist` and `weight_master`. Only frontend page visibility
   keeps them out of the endpoint. Once triggers become the permission, that is
   a privilege-escalation hole.

This has produced three regressions on the same code path since 2026-08-24.

## Decision

**Shipment Settings becomes the single authority for Sheet-row edit access, and
it gets the Permissions-page interaction model (pick a role → tick the rows).**

- For any field owned by a Sheet row, `SheetRowSetting` trigger config IS the
  permission. The `AND can_edit_field` is dropped.
- `RoleFieldPermission` stays the authority for fields that have no Sheet row.
- `export_manager` can administer this without an admin account.

### Decision A — `is_visible` is presentation, not permission

The write gate ignores `is_visible`; only the display map honours it. Hiding a
row removes the column from the Sheet, it does not revoke edit rights on the
detail page or the edit drawer.

Verified against the live DB on 2026-09-02: **0 hidden rows, 0 locked rows**, so
this choice changes no current behaviour either way.

### Decision B — reverse-delegate map

Several Sheet cells write real columns that have no `field_key` of their own.
Without a reverse map they would silently keep falling through to
`RoleFieldPermission`, reproducing the original bug. Mapping (real field → owning
Sheet row):

| Real field | Owning Sheet row | Written by |
|---|---|---|
| `transit_days`, `transport_temp_c` | `transit_days_temp` | `SheetCellEditor` (two numbers, one PATCH) |
| `driver_id` | `driver_name` | `SheetDriverSelectEditor` |
| `truck_head_id`, `trailer_id` | `truck_plate` | `SheetTruckSelectEditor` |
| `vehicle_condition_note` | `vehicle_condition` | `SheetCellEditor` |
| `box_count`, `pallet_count`, `weight_gross`, `packaging_kg`, `pallet_weight_kg`, `packing_template` | `packing` | `ShipmentPackingPanel` |

Fields with genuinely no Sheet row keep `RoleFieldPermission` and still need the
Permissions admin: `notes`, `loading_location`, `peregruz_city`, `price_per_kg`,
`total_amount_usd`, `product_type`, `shelf_life_days`. (`column_color` is
already exempt by name in the serializer.)

### Decision C — packing goes in whole, not half

The packing fields are written from two places: `PATCH /shipments/{id}/` and
`POST /contracts/shipment-packing/` (`useShipmentPacking.ts:60`, driving
`ShipmentPackingPanel`). Mapping them in the reverse table without touching the
second endpoint would give one field two different answers — the exact
divergence this change exists to remove, and the user would tick `packing` for a
role and still get a 403 from the panel.

So `/contracts/shipment-packing/` is gated on `can_edit_sheet_field(user,
'packing')` as part of this change. `apps.core.permissions` is importable from
`contracts` (dependency direction `core ← greenhouse ← export ← contracts`), so
this does not violate the module boundary.

Alternative if this is too wide: drop the packing fields from the reverse map
entirely and leave both paths on `RoleFieldPermission`. Do not ship the split.

### Decision D — wildcard grants must be expanded by the backfill

`FIELD_DEFAULTS` gives `'shipment': ['*']` to `admin`, `export_manager`,
`director` (all of which bypass the gate anyway) — **and to `boss`**
(`seed_permissions.py:516`, `{r: ['*'] for r in _ALL_RESOURCES}`). `boss` is NOT
in the bypass set and NOT in `PRIVILEGED_ROLES`.

`has_any_config` is evaluated per row, not per role: as soon as any role has a
trigger on a row, the no-config fallback disappears for that row and a
wildcard-holding role absent from the triggers is denied. So the backfill must
expand `'*'` across all rows for the holding role. Same rule applies to junction
wildcards — `document_team`'s `shipment_firm_split: ['*']` → the `firm_splits`
row, `loading_dept_head` / `loading_dept_head_deputy`'s
`shipment_block_source: ['*']` → the `block_sources` row.

Not chosen: adding `boss` to the privileged bypass. That is a separate AD-15
question; expanding him in the backfill keeps his access visible and editable in
the new UI instead of hidden in code.

### Confirmed: the two bypass lists already agree

`PRIVILEGED_ROLES` (`apps/core/roles.py:84`) is `{admin, export_manager,
director}` — identical to `can_edit_sheet_field`'s bypass set plus `superuser`.
No reconciliation needed, and the parity test below is not red on day one for a
privileged role.

## Backend changes

### 1. `apps/core/permissions.py`

- `can_edit_sheet_field`: when the row has trigger config, return
  `has_any_trigger` — no longer `and _can_edit_sheet_row_field(...)`. No trigger
  config → unchanged `RoleFieldPermission` fallback. Privileged bypass
  (superuser / admin / director / export_manager) unchanged.
- `get_sheet_edit_map`: same edit inside `_resolve`, so display and write stay
  identical by construction.
- New `_REVERSE_FIELD_DELEGATES: dict[str, str]` (Decision B table), plus a
  `SHEET_OWNED_FIELDS` frozenset = every `DEFAULT_SHEET_ROWS` `field_key` plus
  the reverse-map keys.
- New `can_edit_sheet_fields(user, field_names, settings_by_key=None) -> dict`
  — batch form used by the serializer, one settings query for the whole PATCH.
- Add an `ignore_visibility: bool = False` parameter used by the write path
  (Decision A).

### 2. `apps/export/serializers.py` — `ShipmentPatchSerializer.validate`

Split the submitted fields:

- field in `SHEET_OWNED_FIELDS` → verdict from `can_edit_sheet_fields`
- otherwise → `can_edit_field` as today
- `column_color` stays exempt; `PRIVILEGED_ROLES` short-circuit stays

Needs `request` from context (already passed at `views.py:599`). One settings
query per PATCH, not per field.

### 3. Junction + bulk write paths

- `set_firm_splits` / `set_block_sources`: replace
  `junction_write_permission('shipment_firm_split' | 'shipment_block_source')`
  with a sheet-aware permission keyed on the `firm_splits` / `block_sources`
  row, so those two rows are also governed by Shipment Settings.
- Bulk-op path (`views.py:2604`) already calls `can_edit_sheet_field` per field
  — thread one prepared `settings_by_key` through the loop so N rows do not
  become N queries.
- `POST /contracts/shipment-packing/`: gate on
  `can_edit_sheet_field(user, 'packing')` (Decision C).

### 4. Close the self-grant hole

- New resource `sheet_row_setting` in `permission_registry.py`
  (`RESOURCE_FIELDS` + `RESOURCE_DEFAULTS`), granted view+edit to `admin`,
  `director`, `export_manager` only.
- `SheetRowSettingViewSet.resource_code` changes `'shipment'` →
  `'sheet_row_setting'`.
- Add `admin.shipment_settings` to `PAGE_DEFAULTS['export_manager']`.

### 5. New bulk endpoint for the role-first UI

`POST /api/v1/export/admin/sheet-rows/role-access/`

```json
{ "role": "document_team", "field_keys": ["documents_status", "country", "import_firm"] }
```

Replaces that role's `SheetRowRoleTrigger` rows across every Sheet row in one
transaction, and writes one `AuditLog` row per changed Sheet row using the
existing `triggered_roles` audit shape from `_perform_update_with_audit`.
Gated on `sheet_row_setting.can_edit`. Reads come from the existing
`GET /admin/sheet-rows/` — no new read endpoint.

### 6. Backfill migration

For every Sheet row, add to `triggered_roles` every role that currently holds
the matching `RoleFieldPermission` (resolving the junction and reverse-delegate
maps). Without this, roles that edit today purely via field perms lose write
access the moment the serializer switches.

## Frontend changes

New tab **Row access** on `ShipmentSettingsPage`, placed after `Sheet rows`.

Layout mirrors `pages/admin/permissions/`: role sidebar left, checkbox list
right, one row per Sheet row (row number + label + `field_key`), search box,
"select all" per topic group, dirty-state save bar.

- Reuse `pages/admin/permissions/RoleSidebar.tsx` and the
  `useRolePermissionDrafts` draft/dirty pattern; do not duplicate them.
- Data source: `GET /admin/sheet-rows/` → build `{role: Set<field_key>}`
  client-side from each row's `triggered_roles`.
- Save: `POST /admin/sheet-rows/role-access/` for the edited role.
- Tab visibility gated on `canDo(user, 'sheet_row_setting', 'edit')`.
- i18n keys in `en.json` / `ru.json` / `tk.json`.

### Decision E — exactly one place to grant row access

The Sheet rows tab already has a per-row access editor
(`sheet-rows/SheetRowAccessSection.tsx`: lock switch + triggered-roles select).
Adding the Row access tab without touching it would leave two screens writing
the same `SheetRowRoleTrigger` rows. Granting access must be a one-place job.

- `SheetRowAccessSection` becomes **read-only**: it shows who may edit the row
  (roles + any per-user exceptions) as plain chips, with a link to the Row
  access tab. No select, no save.
- The Sheet rows tab keeps only look-and-behaviour: visibility, order, labels,
  descriptions, colours, width, font.
- Per-user exceptions (`triggered_user`, `user_permissions`) move into the Row
  access tab as a second sidebar group under the roles, so *all* row access —
  by role and by person — is granted on one screen. Defer this to a follow-up
  only if the roles half needs to ship sooner; until then the per-user editor
  stays where it is and the "one place" rule holds for roles only.

### Decision F — `is_locked` is retired from the UI

Under the new rule the lock no longer changes any outcome. With trigger config
present the answer is `has_any_trigger` whether or not the row is locked; the
lock only mattered as the "no triggers → nobody" branch, and after the backfill
every row has trigger config. Live DB already has 0 locked rows.

The column stays in the DB (no migration churn) but stops being exposed or
documented as a control. `can_edit_sheet_field` keeps the branch purely as a
fail-closed guard for a row whose triggers are all removed.

### Propagation timing

Trigger changes take effect immediately: `SheetRowSetting` is read live on every
request, uncached. The new `sheet_row_setting` resource grant itself goes through
`get_resource_perm`'s 60s cache, so granting `export_manager` access to the tab
can take up to a minute to appear. Worth surfacing in the UI copy.

## Tests

Backend:

1. **Parity invariant** — for every (role x Sheet field) pair on a **visible**
   row, the `ShipmentPatchSerializer` verdict equals the `get_sheet_edit_map`
   verdict. This is the property the change buys and the only test that catches
   a missed reverse-delegate.
   Scoping notes, both required for the test to be writable:
   - Visible rows only. Hidden rows are expected to disagree — that is
     Decision A, covered by test 3.
   - Delegated fields have no key of their own in the map (it iterates
     `DEFAULT_SHEET_ROWS`), so the comparison pairs the real field against its
     owning row: `serializer('box_count')` vs `edit_map('packing')`,
     `serializer('truck_head_id')` vs `edit_map('truck_plate')`, and so on.
2. `document_team` in `country`'s `triggered_roles` with **no**
   `RoleFieldPermission` → may edit, and `PATCH /shipments/{id}/` succeeds.
3. A role in `triggered_roles` for a hidden row can still PATCH (Decision A),
   while `get_sheet_edit_map` reports `False` for it.
4. Reverse delegates: `transport` may PATCH `transit_days` / `truck_head_id` /
   `driver_id` purely from the `transit_days_temp` / `truck_plate` /
   `driver_name` trigger grants.
5. `document_team` (holds `shipment.can_edit`) gets 403 on
   `PATCH /admin/sheet-rows/{id}/` and on `role-access/`; `export_manager` gets
   200.
6. Backfill migration: every (role, field) editable before is editable after —
   asserted for **every** role, `boss` included (Decision D's wildcard
   expansion), by snapshotting verdicts pre-migration and re-checking post.
7. Existing `TestEveryRoleCanEditItsOwnSheetRow` stays green.
8. Query-count guard on `PATCH /shipments/{id}/` — one settings load per
   request, not per field.
9. `POST /contracts/shipment-packing/` agrees with the `packing` row: a role
   ticked for `packing` can save from the panel, a role not ticked gets 403
   (Decision C).

Frontend: Row access tab renders roles + rows, ticking marks dirty, save posts
the expected payload, tab hidden without `sheet_row_setting.edit`. Plus:
`SheetRowAccessSection` renders chips only and exposes no control that writes
`triggered_roles` or `is_locked` (Decisions E and F) — assert on the absence of
the select and the switch, so a later refactor cannot quietly bring the second
edit point back.

## Out of scope

- Page and resource permissions — still Permissions-admin only.
- Non-Sheet shipment fields listed under Decision B.
- Retiring `RoleFieldPermission` for `shipment`; it stays for non-Sheet fields
  and every other resource.

## Docs to update

- `docs/ADR.md` — new AD entry: Sheet Settings is the permission authority for
  Sheet-owned fields.
- `docs/obsidian/screens/shipment-sheet.md` — permission section.
- `docs/obsidian/screens/` — Shipment Settings page doc, new Row access tab.
- `docs/obsidian/processes/` — role/permission process doc.
- `CHANGELOG.md`, `BUILD_TEST_LOG.md`.
