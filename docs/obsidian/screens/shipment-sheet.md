---
title: Shipment Sheet
tags: [screen, export, shipment, spreadsheet, ops]
related: [[../processes/shipment-lifecycle]], [[../reference/api-endpoint-map]], [[../processes/permissions-system]]
---

# Shipment Sheet

Excel-style spreadsheet view at `/export/shipments/sheet/`. Each shipment is **one column**; each operational field is **one row**. Mirrors the original Excel "Eksport Hasabat" tab the platform replaced.

Backend: `ShipmentViewSet.sheet()` action at `GET /api/v1/export/shipments/sheet/` returns a flat per-season payload (no pagination — the grid loads the whole season).

## Page layout

```
┌─────────────────────────────────────────────────┐
│  Toolbar  [+ Add column]  [search]  [🜔 Filters] │
├──┬──────┬───────────┬────────┬────────┬─────────┤
│ #│ Who  │ Field     │ S-001  │ S-002  │   ...   │  ← virtualised
├──┼──────┼───────────┼────────┼────────┼─────────┤
│ 2│Logist│ Route     │  ...   │  ...   │   ...   │  ┐
│..│      │           │        │        │         │  │ Frozen top
│14│Solty │ Harvest   │  ...   │  ...   │         │  ┘ (rows 2–14)
├──┼──────┼───────────┼────────┼────────┼─────────┤
│15│Haltac│ Capacity  │  ...   │  ...   │         │  ┐ Scrollable
│..│      │           │        │        │         │  │ bottom
│45│Arap  │ Notes     │  ...   │  ...   │         │  ┘ (rows 15–45)
└──┴──────┴───────────┴────────┴────────┴─────────┘
```

Three frozen left columns (#, Who, Field label) + virtualised data columns rendered via `@tanstack/react-virtual`. A full season (~1,000 shipments × 44 rows) is handled by virtualising columns; only ~20 visible at a time are in the DOM.

## Freeze panes (configurable)

Both axes of the freeze are user-configurable, modelled on Google Sheets:

- **Frozen rows** — top N data rows (default `13`, mirroring the original "rows 2–14 = identity & planning" band). Rendered in a `position: sticky; top: ROW_HEIGHT` band; remaining rows scroll vertically beneath it.
- **Frozen columns** — first N data columns (default `0`). Rendered as `position: sticky; left: <offset>` cells between the label band and the virtualizer container; the remaining shipments are passed to `@tanstack/react-virtual` as the virtualization population.

State lives in `sheetStore` (`frozenRowCount`, `frozenColCount`) and persists to `localStorage` under `ygt-sheet-freeze`. Defaults restore on first visit. The grid clamps stored values against the visible row/column counts each render so a stale localStorage value (e.g. 5C frozen, only 2 shipments visible after filter) still produces a coherent layout.

### Settings modal

The toolbar's **⚙ Settings** button (top-left, after the Filters popover) opens a `Sheet Display Settings` modal that houses the freeze pickers:

- **Freeze rows up to:** Ant `Select` with one option per visible row in the current order — labelled `<field label> (R<row_number>)` (e.g. `Harvest Status (R14)`). Picking row at position N sets `frozenRowCount = N`. The list reflects the user's reordered + visible row sequence (not the original Excel numbering), so freezing matches what the user actually sees on screen.
- **Freeze columns up to:** Ant `Select` with options `After column 1`, `After column 2`, …, capped at `min(20, shipmentCount − 1)`. Picking N sets `frozenColCount = N`. Disabled when there are fewer than 2 shipments.

Both pickers apply changes live (no Save button); the modal has `Reset to default` (rows=13, cols=0) and `Done` (close). A small badge dot on the gear button indicates the freeze is non-default. There is no longer an "Up to current row/column" shortcut — picking the row/column directly from the modal is more discoverable and doesn't require the user to first click a cell.

A blue 2px line on the trailing edge of the last frozen row/column marks the freeze line, mirroring Excel/Sheets. Header label cells (`#`, Who, Field name) are also `position: sticky; left: 0` so they remain visible during horizontal scrolling. Rows and section containers carry `min-width: max-content` so the sticky-left cells are bounded by the row's full content width — without this they unstick once the user scrolls past one viewport-width.

## Zoom

The toolbar's `−` / `%` / `+` group scales the whole grid between **60 %–150 %** in 10 % steps. State: `sheetZoom` in `sheetStore` (actions `zoomIn`/`zoomOut`/`resetZoom`/`setSheetZoom`, clamped + rounded to 2 dp), persisted per browser to `localStorage` under `ygt-sheet-zoom`. Default 100 %.

**Why not CSS `zoom`/`transform`?** The Sheet is virtualized with `@tanstack/react-virtual`. A CSS transform/zoom on the scroll container (or any ancestor of it) makes `scrollLeft` and `getBoundingClientRect()` report values in different coordinate frames, so the virtualizer renders the wrong columns as you scroll — a silent, browser-version-dependent breakage. Instead:

- **Layout px scale in JS.** `scaleSheetLayout(zoom)` in `constants/sheetRowConfig.ts` multiplies every layout constant (`COL_WIDTH_*`, `ROW_HEIGHT`, `FROZEN_LEFT_TOTAL`). `SheetGrid`, `SheetCell`, `SheetCellEditor`, and `SheetLabelColumn` all read `sheetZoom` from the store and derive identical scaled values, so the column virtualizer's `estimateSize`, the sticky-left `left` offsets, and the rendered cell widths stay in lockstep. The column virtualizer's `.measure()` re-runs whenever the scaled width changes so cached item sizes don't go stale. A per-cell custom width (`rowSetting.style.width`) is multiplied by zoom too.
- **Fonts + cell padding scale in CSS.** `SheetGrid` sets `--sheet-zoom: <zoom>` inline on `.sheet-grid`; the font-size and padding declarations in `SheetStyles.css` use `calc(Npx * var(--sheet-zoom, 1))`. The fallback `1` keeps the styles correct anywhere the variable isn't set.

## Row config

**Backend is the single source of truth.** `backend/apps/export/sheet_rows.py` exports `DEFAULT_SHEET_ROWS` (45 entries — row 16 is intentionally absent, matching the original Excel layout). The `/api/v1/export/shipments/sheet/` response ships these as the `rows` top-level key alongside `results` / `comment_counts` / `task_counts`. Frontend renders whatever the API returns; there is no longer a hard-coded `SHEET_ROW_CONFIG` array on the frontend. Adding, removing, or reordering rows is a one-place change in `sheet_rows.py`.

Translation strings (`sheet.who.*`, `sheet.row.*`) stay in `frontend/src/i18n/{tk,ru,en}.json`; the API ships only the i18n keys (`default_who_key`, `label_key`).

Dropdown rows whose `options_source` is fixed (e.g. `vehicle_condition`) resolve via `frontend/src/constants/sheetOptions.ts` `SHEET_OPTIONS_REGISTRY`. Dynamic dropdowns (`country`, `customer`, `border_point`, etc.) keep using their dedicated TanStack Query hooks.

### Role blocks (role bands)

The Sheet is **transposed** — fields are rows, shipments are columns — so "give each role its own block of columns" means a contiguous run of **rows** per role, headed by a labelled band row.

**`IRowConfig.default_who_key` names a person, not a role** (`sheet.who.sirin`, `sheet.who.gadam`, …) — it is the repo's existing single source of truth for "who fills this in today" and is already rendered in Col B ("Who"). It is *not* a role: several people share one role (`document_team` = Sirin + Sulgun; `transport` = Haltac + Mergen + the generic `transport` who-key; `export_manager` = Gadam + Aganazar). Grouping directly by who-key (the first version, 2026-08-23) therefore fragmented one department into several small blocks and labelled each with a person's first name — both reported as defects the next day.

Role resolution now has two tiers, checked in that order:
1. `SheetRowSetting.role_group` — an **admin-managed override**, editable per row in Shipment Settings → Sheet Rows (`sheet_rows.col_role_group`), shipped in the `/sheet/` payload as `IRowConfig.role_group`. This is how the org chart gets corrected or a new hire gets mapped **without a frontend deploy** — see "Admin-managed role groups" below.
2. `sheetRoleBlocks.ts`'s `WHO_KEY_ROLE` — a static fallback for rows the admin hasn't touched. First version (2026-08-24) sourced Aganazar from `docs/DOMAIN.md`'s role→person table by guessing from the one tail row he owns (`sales_report_date` → `sales_rep`) — **wrong**: `backfill_sheet_row_defaults.WHO_TO_ROLE` already had this org-chart decision confirmed directly with the user on 2026-06-02, and it says `export_manager`. A single field's content is not stronger evidence than a confirmed decision; fixed the same day. Migration `0063_sheet_row_role_group` backfills every default row's `role_group` from this exact table, so in practice tier 2 only matters for a row created after that migration and never touched in the admin tab.

Neither present → the row groups under its own raw who-key (safe — a not-yet-mapped who-key is still unique to one row). Deliberately **not** `components/sheet/swapFieldGroups.ts` for the underlying who-key: that map covers only the swappable subset and disagrees with `default_who_key` on `city`, `border_point`, `vehicle_condition`, `vehicle_live_status` and `departed_at`. Reusing it would create a second, contradicting answer to "who owns this field".

**Custom rows are transparent to grouping, on purpose.** Every admin-added custom row (Shipment Settings → Sheet Rows) shares one generic `sheet.who.custom` key regardless of how many exist or what their per-row `who` override displays (e.g. three real ones seen in the wild: "Sirin Resminamalar", "Sirin Transport bölüminiň resminamalary", "Soltanmyrad Ýüklän bölümi"). The first version of this feature treated that shared key like any other owner — with more than one custom row on the sheet, the same key inevitably reappeared in a second, non-adjacent run, tripped the owner-contiguity gate below, and **silently disabled every band on the whole sheet** ("nothing changed", reported 2026-08-24). `WHO_KEY_ROLE` has no entry for `sheet.who.custom` (or the empty `sheet.who.none`), and both `groupRowsByOwner()` and `markRoleBands()` treat an unmapped who-key as **ungroupable**: the row is never reordered, never joins a block, and is skipped entirely by the contiguity check — it can sit inside or next to a role's run without affecting it either way. A role whose only rows are all unmapped and unique to themselves (a genuinely new person not yet in the table) still groups fine — it falls back to grouping under its own raw who-key, which is safe as long as that key isn't shared the way `sheet.who.custom` is.

**Ordering is a client-side view order, not a data change.** `groupRowsByOwner()` (`components/sheet/sheetRoleBlocks.ts`) is applied in `pages/export/ShipmentSheet.tsx` to the `rows` array before it reaches `SheetGrid`, `SheetToolbar` and `sheetStore.setRows` (all three get the same array, or the toolbar's row picker would disagree about positions). It does **not** touch `SheetRowSetting.display_order`, so:

- API consumers and the Shipment Settings → Sheet Rows admin tab still see the admin order;
- `global_position` (the `#` column) keeps pointing at the admin rank, so the numbers read non-monotonically down a grouped sheet (13, then 14, 16, 18, 19, 35, …). That is the price of keeping the admin cross-reference intact. A backend reshuffle of `display_order` is the durable alternative if the numbers matter more than the cross-reference.

**Pinned rows — a field-key set, not a row count (2026-08-27).** `PINNED_FIELD_KEYS = {shipment_code, country, customer, city, import_firm}` are never grouped and never banded — the handful an operator needs visible at a glance while scrolling through the other 40 fields. Originally (2026-08-24) this was `IDENTITY_ROW_COUNT = 13`, a hardcoded *row count* that happened to also pin `vehicle_condition`, `documents_status`, `transport_docs_given_at`, `export_code`, `block_sources`, `firm_splits` and `harvest_status` along with the true anchors — those rows had a `role_group` an admin could set in the Sheet Rows tab that silently did nothing on the Sheet (defect reported the same day the admin override shipped). Owner decision: shrink to exactly the 5 real anchors; everything else groups normally now.

Because the pinned set is field-keys, not a prefix length, `groupRowsByOwner` **filters** rather than slices — the 5 pinned fields are not even contiguous in the raw server order (`block_sources`/`firm_splits` currently sit between `shipment_code` and `country`), so they're pulled to the front in their relative order and everything else (including the 7 released fields above) is grouped exactly like any other row. `pinnedPrefixLength(rows)` (`sheetRoleBlocks.ts`) derives "how many leading rows are pinned" from the actual array — after grouping this equals however many of the 5 are present (fewer if one is hidden); for a user's personal row order it counts however many happen to lead, which can be 0.

This is also what the default freeze setting keeps sticky — `DEFAULT_FROZEN_ROW_COUNT` in `stores/sheetStore.ts`, bumped from 13 to 5 the same day, **with a `localStorage` key version bump** (`ygt-sheet-freeze-v2` → `-v3`) so every browser picks up the new default immediately rather than keeping a stale 13 — the same technique used for the v1→v2 bump. Without that bump, a band still couldn't render before row 13 for anyone who'd ever opened the freeze picker, since `startIndex = max(pinnedPrefixLength(rows), frozenRowCount)` and the stale live setting would dominate the max(). The two stay conceptually paired but are read independently at runtime.

Grouping the remaining 40 rows by role yields **6 blocks**, ordered by first appearance in the server order: `transport` (10: vehicle_condition/Logist + Haltac 2 + Mergen 1 + the generic `transport` who-key 6), `document_team` (6: transport_docs_given_at/documents_status/Sirin + firm_splits/Sulgun + document_note/customs_exit_at/Sirin + customs_clearance_planned_day/Sirin), `export_manager` (5: export_manager_note/firm_contracts/packing/is_gapy_satys/Gadam + sales_report_date/Aganazar), `loading_dept_head` (10: export_code/block_sources/harvest_status/warehouse_note/loading_started_at/loading_ended_at/rejected_weight_kg/weight_net/variety/harvest_date, all Soltanmyrat), `finansist` (1, Babageldi), `sales_rep` (8, Arap). `transport` leads because `vehicle_condition` — released from the old positional pin (2026-08-27) — is the first row after the 5 truly-pinned ones. Blocks are stable — rows keep their relative order inside a block; when two who-keys share a role (e.g. Haltac and Mergen, both `transport`), the block is emitted at the position of whichever appears **first** in the server order, and later same-role rows merge into it from wherever they were.

### Admin-managed role groups (2026-08-27)

`SheetRowSetting.role_group` (migration `0063_sheet_row_role_group`, `ROLE_CHOICES`, blank = no override) lets an admin set or change which block a row belongs to from Shipment Settings → Sheet Rows, no code change required — the gap the previous section's design left ("a newly hired person needs a one-line addition to a hardcoded file"). Exposed read/write on the admin serializer and read-only in the `/sheet/` payload as `IRowConfig.role_group`; `sheetRoleBlocks.ts` checks it before `WHO_KEY_ROLE`.

The column sits next to **Trigger Roles** in the admin table and is easy to confuse with it — they are unrelated. `role_group` decides which *visual band* a row renders in on the Sheet. `triggered_roles` (`SheetRowRoleTrigger`) decides who may *edit* a row once `is_locked` is on. A row can have a `role_group` of `finansist` and a trigger role of `document_team` at the same time; neither implies the other. The column header carries a tooltip (`sheet_rows.role_group_header_hint`) stating this.

Setting `role_group` on an otherwise-`sheet.who.custom` row is the one safe way to put a specific admin-added row into a real block — normally custom rows are excluded from grouping entirely (see below) because their shared generic who-key would re-break the sheet-wide contiguity gate; a per-row `role_group` override does not have that problem, since it is scoped to the one row, not shared.

Row **order** (which block appears first, and a row's position inside its block) is unaffected by this feature — that is still the existing display-order reorder (the ↑/↓ arrows in the same admin tab), which the Sheet's role-block grouping already respects via "first appearance in server order".

**Migration note:** 0063 backfills every one of the 45 default rows' `role_group` from the SAME who-key→role table already confirmed with the user 2026-06-02 for `SheetRowRoleTrigger` seeding (`backfill_sheet_row_defaults.WHO_TO_ROLE`) — not from the frontend's `WHO_KEY_ROLE`, which had briefly diverged on one entry (see above). All three copies (this migration, that command, `WHO_KEY_ROLE`) must be kept in sync if the org chart changes; there is no single source shared across backend and frontend for this table.

**Bands are derived from the rendered order, not assumed.** `markRoleBands(rows, startIndex)` emits a band at each role run-start and returns **all-null when the tail is not role-contiguous**. Three consequences worth knowing:

- Grouping waits for the preferences query to settle (`isSuccess`). `useUserSheetPreferences` ships `placeholderData: { row_order: [] }`, so before it settles a user *with* a personal order looks like one without — grouping in that window would let a drag persist the grouped order over their saved positions. Until then (and on a prefs fetch error) the server order is used as-is; it already has their positions applied.
- A user with a personal row order (`user_preferences.row_order` non-empty) is not re-sorted — grouping would fight their own drags, which persist positions derived from the array the grid was handed. Their sheet renders exactly as before, with no bands, rather than with a band every other row.
- Their **first drag persists this grouped order** (the PATCH is built from the grouped array), so grouping survives a within-block drag. A drag that moves a row *out of* its block breaks role-contiguity and the bands disappear — the view is no longer grouped, and it says so.

`startIndex` is `max(pinnedPrefixLength(rows), frozenRowCount)` because bands render only in the scrollable section; a band must never be swallowed by the sticky frozen band. The first scrollable row therefore always starts a band, even mid-run.

Each band's `rowCount` counts only the rows that actually belong to that role — not the raw index span from the run's start to the next role's start. Since an ungroupable row can sit inside that visual span without being a member, index arithmetic would overcount by one for every such row; `markRoleBands` counts matching rows explicitly instead.

**Own-block highlight.** A band is tinted blue and tagged `sheet.role_block.mine` when the current user may edit at least one row in it, using the `can_current_user_edit` flag the `/sheet/` payload already computes per row per user. Because that is an edit *right* and not ownership, a director/admin would light up all six blocks; the highlight is therefore **suppressed entirely when every block is editable**, so it only ever appears when it discriminates.

**Scroll maths.** Band rows add height above their block, so `navigateActiveCell` adds `bandsBefore(roleBands, newRow) * bandHeight(ROW_HEIGHT)` to the row's flow offset. `bandHeight()` is the single definition of that height, shared by the band component and the scroll correction, so they cannot drift at non-100 % zoom. The sticky band height is unchanged because bands never appear in the frozen section.

**Caveat — band label vs Who cell.** Col B resolves the admin DB override (`rowSettings[fk].who[lang]`) first and only falls back to `t(default_who_key)` — the person filling the field today. The band renders `t(band.labelKey)`, which is `roles.<code>` for a mapped who-key (a department name) or a raw who-key fallback for an unmapped one, so a per-row `who` override can make one row's Who cell read as a person while its band reads as their role. Correct behaviour — the band names the structural owner, Col B names today's person — but surprising side by side.

Files: `components/sheet/sheetRoleBlocks.ts` (pure, unit-tested in `sheetRoleBlocks.test.ts`), `components/sheet/SheetRoleBandRow.tsx`, `.sheet-role-band*` rules in `SheetStyles.css`.

### Per-user row order and visibility (Phase 2a — ADR-0003/ADR-0008)

Users can reorder and hide sheet rows through the toolbar. Preferences are stored server-side in the `UserSheetRowPref` table (one row per `(user, SheetRowSetting)`) and synced debounced from the frontend.

**Model**: `export_user_sheet_row_pref` — flat child table (no JSONField, MSSQL-safe per ADR-0008).
- `position`: sparse integer (step 1024). NULL = inherit admin `display_order`.
- `is_hidden`: true = hidden from this user's view. AND-composed with admin `is_visible`.

**Row order resolution** (in `/sheet/` action):
1. Load all `UserSheetRowPref` for the request user (1 query).
2. For each row in `DEFAULT_SHEET_ROWS`:
   - Skip if admin `is_visible=False` (admin-hidden; hard override).
   - Skip if user `is_hidden=True` (user-hidden).
   - `effective_order = user.position ?? setting.display_order` (fallback 999999 if no DB config).
3. Sort by `effective_order` (stable).

**`user_preferences` key** in `/sheet/` response:
```json
{
  "user_preferences": {
    "row_order": [12, 5, 8, ...],   // ids where user.position IS NOT NULL, ordered ASC
    "hidden_rows": [3, 14, ...]     // ids where user.is_hidden=True
  }
}
```
Frontend uses `user_preferences` to initialise the drag-and-drop row order state without a separate API call.

**Sync endpoint**: `GET/PATCH /api/v1/export/user/sheet-preferences/` — `UserSheetPreferencesView`. Auth: `IsAuthenticated`. PATCH accepts `{ row_order?: [...], hidden_rows?: [...] }` — absent key = no-op. Both keys are idempotent: the payload fully replaces the dimension it targets. The `row_order` key lists only ids with user-set positions; unlisted rows fall back to admin `display_order`.

### Per-row trigger configuration (Sheet Control v2)

Each row can be assigned **one or more formal roles** AND/OR **a specific user** and **extra users**, configurable in **Shipment Settings → Sheet Rows** (admin-only). The config is stored across three tables:

| Table | Purpose |
|-------|---------|
| `export_sheet_row_setting` | One row per `field_key`. Holds labels, description, style, `is_locked`, soft-delete fields, optimistic `version`. |
| `export_sheet_row_role_trigger` | Child rows: one per `(setting, role)`. Replaces the old single `triggered_role` column. |
| `export_sheet_row_user_permission` | Child rows: one per `(setting, user)`. Extra users who can edit regardless of `is_locked`. Soft-deleted with `deleted_at`. |

**Trigger + Lock semantics (ADR-0008 / ADR-0009 / ADR-0010):**
- If `is_locked=False` (default): `triggered_roles[]` acts as the "Who" label. Editing falls back to `RoleFieldPermission` for all roles — the trigger is display-only.
- If `is_locked=True`: only users whose role is in `triggered_roles[]` **OR** who appear in `extra_user_ids[]` (non-deleted `SheetRowUserPermission`) can edit the cell. All other roles get the fallback "no setting → field-perm" path denied.
- If both `triggered_roles[]` and `triggered_user` are empty (`is_locked=False`), only `RoleFieldPermission` governs access.
- `admin`, `director`, and `is_superuser` always bypass the lock.

**"Who" column label:**
1. `triggered_user.username` if a specific user is set (warning chip if `is_active=False`).
2. First matched `triggered_roles[]` label (role display name) if any roles are configured.
3. Fallback: translate `default_who_key` from i18n.

**Edit-map**: `get_sheet_edit_map(user)` computes edit access in **4 DB queries** (1 settings + 2 prefetch for `role_triggers` and `user_permissions` + 1 field perms). Result is embedded in the `/sheet/` response as `row_settings[field_key]` — the frontend never makes per-cell permission calls.

**Admin endpoint**: `GET/POST/PATCH/DELETE /api/v1/export/admin/sheet-rows/{id}/` — see the Sheet Rows Admin section below.

**Visibility toggle**: `is_visible=False` rows are excluded entirely from the `row_settings` map in the `/sheet/` response. Hidden rows are always denied edit access.

### Per-row cell styling (Style popover)

The **Display** section of the row detail panel in **Shipment Settings → Sheet Rows** (shared `SheetRowStyleControls`) configures how a row's data cells render across every shipment column. All style fields are split columns on `SheetRowSetting` (ADR-0008 — no JSONField) and travel to the frontend inside `row_settings[field_key].style` (omitted keys = unset):

| Field | Values | Effect |
|-------|--------|--------|
| `style_width` | 50–500 (px) | Column width; multiplied by `sheetZoom`. **No longer editable in the UI** (dropped as unusable); column still exists and any pre-set value is still honoured on render. |
| `style_align` | left / center / right | Text alignment. **No longer editable in the UI** (dropped as unusable); column still honoured on render. |
| `style_color` | `#RRGGBB` | Cell background (auto WCAG-contrast text unless `font_color` overrides). |
| `style_font_color` | `#RRGGBB` | Cell text color override. |
| `style_font_weight` | bold / normal | Cell text weight. **Blank = bold** — every data cell renders bold by default; admins set `normal` to un-bold a row. |
| `style_font_style` | normal / italic | Cell text style. Blank = upright. |
| `style_font_family` | dm_sans / inter / mono / serif | Cell font family (controlled allowlist; key → CSS stack via `SHEET_FONT_FAMILY` in `SheetCell.tsx`). Blank = inherit the sheet's default font. |
| `style_font_size` | 8–28 (px) | Cell text size; multiplied by `sheetZoom` on render to track the rest of the cell. Null = inherit the sheet default (11px). |

**Default-bold rule:** the bold baseline lives in `SheetCell` *outside* the `style?.` optional chain (`font_weight === 'normal' ? 400 : 700`), so it applies even to fallback rows with no `SheetRowSetting` (`style === null`). Per-value conditional colors and per-shipment column tints still take precedence over `style_color`. Typography is applied to the default `.sheet-cell__text` render; special-render cells (shipment code, country-with-flag, firm/block tags) keep their own component-level weights and do not inherit these row overrides.

**Editable from the Sheet too (gear popover).** The same style controls are reachable directly from the Sheet without opening the admin tab. Each row's label band (Col C) carries a **gear icon** (`SheetRowSettingsPopover`, replacing the old "…" kebab). Clicking it opens a popover with:
- **The style controls** (the shared `SheetRowStyleControls` component, identical to the admin tab): background + font color (on one line), font weight, font style, font family, font size. (Width + alignment were removed as unusable.) Shown only to **admin / director / export_manager / superuser** (gated by `canEditRowStyle` in `SheetGrid`; the backend PATCH on `/admin/sheet-rows/{id}/` enforces the same shipment-edit permission).
- **Hide row** — the per-user `is_hidden` preference, available to everyone (any user with a DB-backed row).

Edits PATCH the global `SheetRowSetting` via `useSaveSheetRowSetting`, which invalidates `['shipments','sheet']` so the change is visible immediately and `version` refreshes for the next edit; a stale-version 409 prompts a refresh modal. Non-privileged users still see the gear, but it offers only **Hide row**. Fallback rows with no `SheetRowSetting` (`id === null`) cannot be styled (no PATCH key) — they show the hide action only.

### Sheet Rows admin UI — list + detail panel (2026-08-27)

The tab was a single 13-column table: 45 rows × ~2000px of horizontal scroll, three stacked
inputs per row in both the Label and Who columns (270 text inputs on screen), and every cell
saving on its own PATCH. Operator verdict: unusable. It is now **master–detail**:

- **Left — `SheetRowList` / `SheetRowListItem` (360px).** Search over field_key + resolved label,
  a `Segmented` filter (all / hidden / locked / with triggers / custom), and one line per row:
  position, label in the admin's language, `field_key`, and badges for hidden / locked / trigger
  count / custom. Reorder arrows live here and are **disabled while a search or filter narrows
  the list** — `/reorder/` takes the FULL order, so a swap inside a filtered view would move the
  row against a neighbour the admin cannot see.
- **Right — `SheetRowDetail` (pinned panel, not an overlay).** Everything about the selected row
  in five sections: Labels (tk/ru/en), Who (tk/ru/en), Tooltip (tk/ru/en), **Access**, Display
  (`role_group` + the shared style controls). Header carries `field_key`, position, the
  visibility switch, the audit line and — for custom rows — delete.

**One action = one PATCH.** The panel edits a local draft (`rowDraft.ts`) and saves through
`useSaveRowDraft` as a single PATCH carrying every changed field. This is not cosmetic:
`useSaveSheetRowSetting` invalidates the list on success, so a second mutation fired from the same
user action would send a stale `version` and 409. Switching rows with unsaved edits asks first.

**Extra users were removed from the UI (2026-08-27, owner call).** The panel used to carry a
per-user grant list (`SheetRowUserPermission` via `permissions/bulk/`) beside the trigger roles.
Since the trigger gate is AND-composed with the field permission, a per-user grant can only ever
narrow *within* a role that already holds the field permission — it cannot hand access to someone
whose role lacks it. With roughly one person per role in this org that is a distinction without a
difference, so the control, the `useBulkPermissions` hook and their strings are gone. **The backend
is untouched:** the model, the `permissions/bulk/` endpoint and `matched_extra` in
`can_edit_sheet_field` / `get_sheet_edit_map` all still work, and any `SheetRowUserPermission` rows
already in a database keep granting edit access — they are simply no longer visible or editable
from this screen (dev DB at removal time: 2 active rows, both for `admin`, who bypasses every gate
anyway).

**The Access section is the comprehension fix.** `is_locked` and `triggered_roles` used to sit in
separate columns with nothing saying how they combine. The section now states the rule the backend
actually applies (`can_edit_sheet_field` / `get_sheet_edit_map`), in three states:

| Lock | Triggers | Who can edit |
|------|----------|--------------|
| off | none | anyone whose role has the field permission |
| off or **on** | any role set | only those roles, **and** they still need the field permission |
| on | none | nobody (admin / director / export_manager bypass every branch) |

Two things the old UI actively mis-taught and the panel now says out loud: the trigger gate is
**AND-composed with the field permission, never OR** — a trigger role does not let someone edit a
field their role has no permission on; and **the lock only matters while no role is selected** —
once one is, locked and unlocked evaluate identically. `role_group` is called
out as visual grouping that grants no access.

Files: `pages/admin/shipment-settings/SheetRowsTab.tsx` (container) + `sheet-rows/` (list, item,
detail, header, access section, localized field group, draft helpers, save hook, custom-row
modal). Tests: `SheetRowsTab.test.tsx` (batched PATCH, lock sentence, dirty gate, switch guard).
The old `SheetRowStylePopover` / `SheetRowTooltipPopover` / `InlineSavedInput` were deleted —
`components/sheet/SheetRowStyleControls` (shared with the Sheet gear popover) stayed.

### Sheet Rows Admin endpoint

`/api/v1/export/admin/sheet-rows/` — managed by `SheetRowSettingViewSet`. Auth: `admin` role only.

| Method | Path | Action |
|--------|------|--------|
| GET | `/sheet-rows/` | List all rows (`?include_deleted=1` shows soft-deleted) |
| GET | `/sheet-rows/{id}/` | Row detail with `role_triggers[]` and `user_permissions[]` |
| POST | `/sheet-rows/` | Create a new setting |
| PATCH | `/sheet-rows/{id}/` | Update labels, `is_locked`, `triggered_user`, `triggered_roles[]`, style. Requires matching `version` (optimistic lock) — wrong version → 409 Conflict. |
| DELETE | `/sheet-rows/{id}/` | Soft-delete (sets `deleted_at`). Rejected with 400 if row is still `is_visible=True`. |
| POST | `/sheet-rows/{id}/restore/` | Restore a soft-deleted row. Returns 400 if already active. |
| POST | `/sheet-rows/reorder/` | Accepts `[{"id": N, "display_order": N}]`. Uses sparse ADR-0007 spacing (`(idx+1)*1024`). Writes one `AuditLog` row for every order change. |
| POST | `/sheet-rows/{id}/permissions/bulk/` | Bulk grant/revoke `SheetRowUserPermission`. Body: `{"grant": [uid, ...], "revoke": [uid, ...]}`. Idempotent. |

**Optimistic locking (ADR-0006):** Every PATCH must include `version` matching the current DB value. The server increments `version` on save. Concurrent edits are detected and return 409 with `{"error": "Version conflict. Reload and retry.", "current_version": N}`.

**Soft-delete (ADR-0002):** `DELETE` sets `deleted_at` + `deleted_by`. Soft-deleted rows are excluded from the default `get_queryset()` (manager `.active()`). Use `?include_deleted=1` to see them. Restore via `/restore/`.

**Sparse display_order (ADR-0007):** Rows use step=1024 spacing (1024, 2048, …). Reorder recalculates from scratch. Inserting between two rows uses midpoint; no rebalancing needed until values collapse.

| Section | Rows | Purpose |
|---------|------|---------|
| Frozen top | 2–14 | Identity & planning — route note, customs/docs/harvest status, shipment code, blocks, firms, country, customer, city, import firm |
| Scrollable bottom | 15–44 | Operations & logistics — truck capacity, loading/departure timestamps, transport, border, weights, variety, sale window, sales report flag |

Row numbers mirror the original "Eksport Hasabat" Excel sheet so users can cross-reference the platform view with their spreadsheet by row index. Earlier versions of the platform had a one-row offset on R20+ (loading_started_at was rendered on R20 instead of R19, transit_days_temp on R27 instead of R26, etc.); that has been corrected.

**Per-role freeform notes (R17, R18):** Plain text cells, parallel to Gadam's `export_manager_note` (R5). R17 holds `warehouse_note` — owned by Soltanmyrat (`loading_dept_head`); deputies (`warehouse_chief`) share the same field. R18 holds `document_note` — owned by Şirin (`document_team`). Editable inline like any other text cell; per-cell discussion threads still live on each cell's CommentMarker.

**R4 — `transport_docs_given_at` (Şirin / `document_team`).** Datetime cell logging when the transport department handed over the shipment docs. Empty state renders `Berilmedi` (not the generic em-dash) so an unfilled cell is unambiguous; picking a date+time implies `Berildi` at that moment. Repurposed from the legacy Malik "Goşmaça bellik" column per in-app feedback #9 — `Shipment.notes` still exists on the model (and on the Detail view) for historical data but is no longer surfaced on the Sheet.

## Comments Drawer

The Sheet has a right-side **Comments Drawer** (Ant `Drawer`, `mask=false`, 360px) for cell-anchored discussions and task assignment. Full process documented in [[../processes/comments-tasks]] — short summary here:

- **Open**: Comments button in the toolbar, OR click any cell's blue/orange/green marker badge
- **Filters** (chip group in drawer header): _This cell_ (when a cell is active), _All cells_, _My tasks_
- **Compose**:
  - Type `@` → user/role autocomplete popover (`useMentionable`)
  - Type `#` → cell autocomplete popover (from the `rows` payload of `/sheet/`)
  - Toggle "Pin to active cell" — sets `field_key` so the comment becomes a cell anchor
  - Pick an Assignee → comment becomes a task; assignee gets `task_assigned` notification
  - Ctrl+Enter to send
- **Markers** appear in cell corners when a cell has comments: blue (comment), orange (open task), green (done)
- **Deep-link**: `/export/shipments/sheet?shipment={id}&row={fieldKey}&comment={id}` selects the cell, auto-opens the drawer, and scrolls the comment into view with a 2-second highlight ring. Used by all three new notification kinds (`mention`, `task_assigned`, `task_done`).

The sheet endpoint response now includes top-level `comment_counts` and `task_counts` dicts keyed by shipment ID — used by the cell markers and the toolbar's "my open tasks" badge respectively.

## Cell-level edit audit (clock-icon marker)

Every shipment field PATCH writes one `AuditLog` row per changed field with structured `(field_name, old_value, new_value, user, timestamp)` (`backend/apps/export/services/sheet_audit.py` `render_field_value()` is the single rendering source — `__str__` for FK objects, `format(d, 'f')` for Decimals, `.isoformat()` for date/datetime, `.label` for TextChoices). Same-value PATCHes write zero rows. The save and the audit `bulk_create` run inside one `transaction.atomic()` so a save failure rolls back audit rows too. Existing 403/400 forbidden-field path on `partial_update` is preserved.

The `/sheet/` response includes a sparse `last_edits[shipment_id_str][field_key] = {user_id, user_name, old_value, new_value, edited_at}` map — populated by a single window-function query (`Window(RowNumber(), partition_by=[object_id, field_name], order_by=created_at DESC)`, filtered to `rn=1` via `Subquery(values('pk'))` so it stays MSSQL-safe and bounded to the visible shipments). Cells with a matching entry render a small clock-icon marker (`CellLastEditMarker`, harmonised with `CommentMarker`):

- **Hover** → tooltip `"Last edited by {user} on {date} — {old} → {new}"`
- **Click** → Ant `Popover` lazily fetches `GET /api/v1/export/shipments/{id}/field-history/?field=<field_key>&limit=50` (paginated, newest-first) and renders the prior edits. Endpoint requires `can_edit_sheet_field(user, field_key)` — readers without edit access see the latest summary on hover but get 403 + `t('sheet.history_forbidden')` on click (privacy: historical values may include old prices, phones).

Defaults: `?limit` defaults to 50, capped at 200. The popover does no pagination of its own — limit-based truncation only.

**Known limitation:** fields modified by `save()` side effects (computed totals, auto status transitions) are NOT captured by this hook — only fields the user actually submitted in the PATCH body. Status transitions already emit their own `AuditLog` rows from `services_workflow.py`. Other side-effect fields would need their own service-level hooks.

R24 = `has_doc_advance` (✓/❌, Babageldi). True once a `FinansistAdvanceShipment` row links the shipment to a `FinansistAdvance` — i.e. the finansist has issued documentation/customs money for the shipment. Click navigates to `/export/advances?shipment={id}`. R25 = `customs_exit_at` (Türkmenistan customs exit, Şirin). R26 = `transit_days_temp` — a virtual combined cell that displays `${transit_days}d ${transport_temp_c}°C` and edits via a single text input. Operators type two numbers (e.g. `5 4` → days=5, temp=4); `SheetCellEditor` parses and PATCHes both real fields (`transit_days`, `transport_temp_c`) in one request. The Sheet perm gate (`can_edit_sheet_field`) special-cases this virtual key and delegates to the real `transit_days` field's perm; the row's `default_who_key` is `sheet.who.transport`. Owned by the Transport role.

## Keyboard navigation & type-to-edit

A `window` `keydown` listener in `SheetGrid` drives spreadsheet-style navigation against `sheetStore.activeCell` (the selected cell, set on single click). It reads volatile flags via `getState()` so it isn't re-bound on every store change, and it bails when the event target is an `INPUT` / `TEXTAREA` / `SELECT` / contenteditable (the open editor, comments composer, or search box) or when `joinMode` / `swapMode` is active.

- **Arrow keys** — move `activeCell` one cell in the chosen direction, skipping gapy-hidden cells and scrolling the virtualizer / container to keep the new cell in view.
- **Enter** — opens the editor on the active cell (no-op on `readonly` rows).
- **Type-to-edit (Google Sheets parity)** — typing any single printable character on the active cell opens its editor immediately, **replacing** the cell's content with that character — no Enter or click first. For `text` / `phone` / `number` (and the R26 `transit_days_temp` combined cell) the typed glyph becomes the editor's seed value via `sheetStore.editSeed`, and the caret is placed after it so the next keystroke appends. For `dropdown` / `date` / `datetime` / `status` / `multiselect` the keystroke just opens the editor (these ignore the seed; the first char is dropped). The modifier guard permits **AltGr** (`Ctrl+Alt` → a real glyph, e.g. Turkmen `ş/ç/ý/ň` on some layouts) while still rejecting `Ctrl`/`Meta` shortcuts like `Ctrl+C`. `editSeed` is carried on `setEditingCell(cell, seed?)` and cleared on every editor open/close.
- **Commit-and-hop (arrow keys while type-editing)** — once a `text` / `phone` / `number` / `transit_days_temp` editor is open **in type-to-edit (seeded) mode**, pressing an arrow key **commits the current value and moves the selection one cell** in that direction — the spreadsheet flow of typing a value then arrowing to the next cell. The editor (`SheetCellEditor.handleSeededKeyDown`) owns the commit (it knows the field type / save endpoint) and signals direction via `sheetStore.pendingNav`; `SheetGrid` watches `pendingNav` and runs the shared `navigateActiveCell()` (the same find-next-non-hidden-cell + scroll logic the arrow listener uses), then clears the flag (gated on `editingCell` so the async `custom_*` close path hops only after the editor unmounts). The handler `preventDefault`s the caret move; the committed value is read at event time so it is exactly what was typed even if antd `InputNumber` also steps. **Editors opened via Enter or click** (`editSeed == null`) keep the **native caret behavior** so operators can fix a typo mid-value; only seeded edits hop. `Escape` always cancels.

## Clipboard & Delete (Google Sheets parity)

The same `SheetGrid` `keydown` listener also drives single-cell clipboard shortcuts against `activeCell`, handled **before** the nav / type-to-edit branches so they never fall through to opening the editor. They act only while a cell is selected and **not** editing / in `joinMode` / `swapMode`, and are skipped entirely when the event target is a form control (so native copy/paste wins inside the open editor, comments composer, or search box). The engine lives in two hooks: `useSheetClipboard` (the C/X/V/Delete handlers) and the shared `useSheetCellWrite` (`writeCell` / `clearCell` — the typed save + clear paths, also used by the right-click **Clear cell** menu). The in-app clipboard payload is `sheetStore.clipboard` (`{fieldKey, inputType, rawValue, displayText}`).

- **Ctrl/⌘+C — copy** — stores the active cell's **raw value** (FK id, option code, ISO date, number, or `custom_fields[key]` string) plus its **formatted display text** (`getCellValue`) in `sheetStore.clipboard`. The in-app clipboard is the workhorse for all in-Sheet paste. It also best-effort mirrors the display text to the OS clipboard via `navigator.clipboard.writeText` for external paste into Excel — but `navigator.clipboard` is only defined in a **secure context (HTTPS / localhost)**, so on the plain-http beta server this silently no-ops (the `readText` paste fallback likewise) while in-Sheet copy/paste keeps working off the in-app clipboard. The optional-chained call (`navigator.clipboard?.writeText?.(…)`) short-circuits safely when the API is absent. Shows a brief `t('sheet.cell_copied')` toast (cells have no marching-ants selection rectangle yet).
- **Ctrl/⌘+X — cut** — copy, then `clearCell` the source immediately (cut = copy + clear), gated by the same editability + `isClearableField` checks as Delete. Non-clearable cells (`shipment_code`, computed flags, bool dropdowns) copy only.
- **Ctrl/⌘+V — paste** — type-safe, routed through the field's own save path:
  - **Same `fieldKey`** → `writeCell` with the stored **raw value** (full typed paste: FK ids, option codes, dates, numbers, `custom_*` strings all round-trip correctly).
  - **Different field, both free-text** (`text` / `phone`) → paste the **display text**. No FK↔string or code coercion across types — those are rejected with `t('sheet.paste_incompatible')`.
  - **No in-app clipboard** (value copied from another app) → for a free-text target, try `navigator.clipboard.readText()`; if it delivers text, write it. When `readText` is unavailable (insecure context — the plain-http beta server) or permission-blocked, **open the cell editor** so the user can paste natively (a native `Ctrl+V` into the focused input works even when the clipboard API is blocked). This replaced an earlier dead-end "nothing to paste" toast that left external paste impossible on http.
  - **Read-only / junction targets** (`firm_splits`, `block_sources`) are rejected with `t('sheet.paste_readonly')` / `t('sheet.paste_unsupported')` — junctions need the inline multiselect editor.
- **Delete / Backspace — clear** — `clearCell` the active cell when editable, `isClearableField`, and not already empty (same gate as right-click **Clear cell**).

`clearCell` (used by Cut / Delete / right-click **Clear cell**) sends **`''` for `text` / `phone` cells** and `null` for other scalar types: the per-role note columns (`*_note` / "belligi") are NOT NULL `CharField`s with default `''`, so a `PATCH` with `null` was rejected ("This field may not be null"). FK / date / number fields stay nullable and clear to `null`.

Still out of scope (deliberately): **range selection / multi-cell fill** (selection is single-cell).

## Undo (Ctrl+Z)

`Ctrl/⌘+Z` on the grid pops the most-recent cell write (LIFO) and replays its reverse. It is **grid-global** (no active cell needed), handled in the same `SheetGrid` keydown listener after the form-control bail (so native input undo wins while a cell editor is open) and skipped during join/swap. Matches on `e.code === 'KeyZ'` (layout-independent); `Ctrl+Shift+Z` is reserved for a future redo.

**Coverage:** every Sheet write path — inline editor edits, paste, cut, delete, clear, dropdowns, dates, FK, the R26 `transit_days_temp` combined cell, and the junctions (`firm_splits`, `block_sources`, `variety`).

**Architecture** (`stores/undoStore.ts`, `hooks/undoCapture.ts`, `hooks/useApplyUndo.ts`):
- **Stack:** a bounded (`MAX_UNDO = 50`) in-memory Zustand list of typed, closure-free descriptors keyed by *reverse mechanism* — `cell` (scalar + `custom_*` + FK → reverse via `writeCell`), `multi` (the R26 pair → `patchMulti`), `junction` (`firm_splits`/`block_sources` → re-POST), `varieties` (→ `varieties/override`). Cleared on Sheet unmount (entries resolve by `shipmentId`, so filter/search don't clear it).
- **Capture (distributed):** each write site reads the cached `before` value and calls a recorder *before* the mutation, threading a per-call `{ onError: dropEntry, onSuccess: setEntryAfter }`. `onError` drops entries whose optimistic write rolled back; `onSuccess` overwrites the guard baseline (`after`) with the **reconciled server value** (DRF serializes decimals→string / dates→ISO, so the sent value wouldn't match the cache). No-op saves (`before === sent`) aren't recorded.
- **Reverse (centralized):** a pure, unit-tested `planUndo(entry, liveShipment, rowConfig, refData)` decides the action or a skip; `applyUndo` dispatches it.
- **`isUndoing` guard:** `applyUndo` sets this before the reverse write (which itself routes through the capturing `writeCell`) and clears it in a `queueMicrotask`, so `pushUndo` no-ops during replay — otherwise the stack would ping-pong forever.

**Guards & skips (each toasts):**
- **Concurrent-edit guard** — if the cell's current value differs from the recorded `after` (someone/something changed it since), undo is skipped (`sheet.undo_cell_changed`) rather than clobbering the newer value. Best-effort for junction/varieties (their endpoints echo no scalar to compare).
- **Shipment gone** (`sheet.undo_cell_gone`); **deactivated firm/block** can't resolve code→id (`sheet.undo_unsupported`); **varieties back-to-empty** is unrecoverable since `varieties/override` no-ops on empty (`sheet.undo_unsupported`); **empty stack** (`sheet.undo_nothing`).

**Honest cascade handling (warn-on-undo):** when the original edit had **advanced the shipment status** (auto-advance cascade), undo restores the cell value AND toasts `sheet.undo_cascade_warning` ("Value restored, but the status advance *from → to* was not reverted"). The lifecycle is forward-only — a value re-PATCH cannot reverse a `transition_to`, its notifications, or created/closed tasks. Cascade is detected by comparing the pre-edit `status_code` to the PATCH response's; **detection is limited to scalar/multi PATCH** (the junction/custom endpoints return `{status:'ok',count}` with no shipment status, so a `block_sources` cascade can't be surfaced without a refetch, which is deliberately avoided).

## Input types

| `inputType` | Editor | Notes |
|-------------|--------|-------|
| `text` | Ant `Input` | Strings; saves on Enter or blur |
| `number` | Ant `InputNumber` | Decimals for kg, USD |
| `phone` | Ant `Input` | Driver phone — same as text, semantic only |
| `date` | Ant `DatePicker` | ISO date (YYYY-MM-DD) |
| `datetime` | Ant `DatePicker showTime` | ISO 8601 with offset |
| `dropdown` | Ant `Select` | Options from reference hooks (countries, firms, …) or `ShipmentOptionType` by category |
| `multiselect` | Ant `Select mode="multiple"` | Junction tables (`firm_splits`, `block_sources`) — posts to `block-sources/` / `firm-splits/` action endpoints. R38 `variety` is also a multiselect (Soltanmyrat picks 1–4 dominant sorts); it posts to `varieties/override/` with `{variety_ids:[…]}` and is gated to `loading_dept_head`, `warehouse_chief`, `export_manager`, `director`. The dropdown has an explicit **Done** button (`dropdownRender` footer) that commits and closes; users no longer have to click another cell to dismiss it (which would open that cell's editor). Click-outside still commits via `onOpenChange`; a guard ref prevents a double save. |
| `status` | Ant `Select` | Options from `ShipmentOptionType` filtered by `category = fieldKey` |
| `readonly` | None | Display-only; never editable |
| `comment_count` | None | Display count + icon; click navigates to ShipmentDetail's Changes tab |

## Right-click context menu

Every non-hidden cell is wrapped in an Ant `Dropdown` (`trigger={['contextMenu']}`) so right-click always opens a Sheet-owned menu instead of the browser's native one. Two items: **Show edit history** (clock icon) above a divider, then **Clear cell**.

**Show edit history** is enabled on every cell. It opens an Ant `Modal` (`t('sheet.history_title')`) that lazily fetches the same `GET /api/v1/export/shipments/{id}/field-history/?field=<field_key>&limit=50` endpoint as the in-cell `CellLastEditMarker` clock badge and renders the rows newest-first — editor name, timestamp, `old → new`. The modal body is the shared `FieldHistoryContent` component (extracted from `CellLastEditMarker`); the modal mounts only while open and `useFieldHistory` fires only on open, so it adds nothing to the ~880 cells at peak. 403 (reader without `can_edit_sheet_field` on a sensitive field — old prices/phones) degrades to `t('sheet.history_forbidden')`; no recorded edits shows `t('sheet.history_empty')`.

The `date` and `datetime` editors deliberately disable Ant's built-in `allowClear` X (operators kept accidentally wiping saved values when missing-click the picker's X), so the right-click → Clear cell path is the supported way to null a filled cell.

**Clear cell** calls the shared `useSheetCellWrite().clearCell(shipment, rowConfig)` (the same engine the Cut / Delete shortcuts use) and dispatches per field type. All three paths apply an instant cache update first (so the cell repaints empty on the next render) and only then fire the network request:

- `custom_*` rows → optimistic `custom_fields[key] = ''` on the cached row, then `PATCH /shipments/{id}/custom-fields/` with `value=''`. Snapshot rolled back to the previous cache on error.
- `multiselect` junctions (`firm_splits`, `block_sources`) → optimistic `[field] = []` on the cached row, then `POST /shipments/{id}/firm-splits/` or `block-sources/` with the items array empty (server replaces all rows, so empty = delete-all). Snapshot rolled back to the previous cache on error. **No post-success sheet invalidate** — the junction endpoints only return `{status, count}`, so the optimistic update IS the truth; an invalidate here would re-trigger a full-season refetch (~1–2 s, ~1000 rows) and felt like "needs refresh" before this was added.
- FK fields (`country`, `customer`, `city`, `import_firm`, `variety`, `border_point`, `vehicle_responsible`) → wipe cached companion fields (`country_name`, `country_code`, `country_color`, etc.) via `applyOptimistic` *before* `useShipmentPatch` fires, so the cell flips empty on the next render instead of waiting ~200–500 ms for the PATCH response to land via `reconcileFromServer`. The reconcile step still runs and overwrites with the authoritative response.
- Everything else → plain `PATCH /shipments/{id}/` via `useShipmentPatch` (the existing optimistic+reconcile path is enough — scalar fields have no companion data), with `{field: ''}` for `text` / `phone` columns (NOT NULL CharFields, default `''`) and `{field: null}` for nullable types (date / number).

The menu item is **disabled (greyed out)** rather than the whole menu being suppressed, in these cases — so the menu still mounts and future items can become enabled on a per-case basis:

| Disabled when | Why |
|---|---|
| Cell is empty | nothing to clear |
| Cell is not editable (role/lock) | user can't write the field anyway |
| `shipment_code` | primary identifier — must never be null |
| `has_doc_advance`, `has_sales_report` | computed from related rows, can't be set directly |
| `peregruz`, `is_gapy_satys` | bool-backed 0/1 dropdowns — pick "no" from the dropdown instead |
| Reorder mode is active | edits are blocked while reordering columns |

Hidden cells (`gapy_hidden && is_gapy_satys` — the `—` placeholder rows) are the only ones that skip the Dropdown wrapper entirely; they have no semantic content to act on.

## Permissions

The sheet now reads from the **dynamic permission registry** (no hardcoded role matrix):

- Direct shipment fields → `canEditField(user, 'shipment', fieldKey)` — gated by `RoleFieldPermission`
- Junction tables → `canDo(user, 'shipment_firm_split' | 'shipment_block_source', 'edit')`
- Add-column button → `canDo(user, 'shipment', 'create')`

Directors manage these matrices at `/admin/permissions`. The seed defaults are populated by `seed_permissions`.

This frontend fallback is only reached when the backend's Sheet Control v2 gate (§ Per-row
trigger configuration above) sends `row_settings[fk].can_current_user_edit = null` — which it
never does (it always emits `true`/`false`). So the real authority for `firm_splits` /
`block_sources` is `can_edit_sheet_field` / `get_sheet_edit_map`
(`apps/core/permissions.py`), and it now mirrors the row above: junction field_keys resolve
against their own resource_code (`shipment_firm_split`/`shipment_block_source`) via
`_JUNCTION_FIELD_DELEGATES`, not `'shipment'`. Before this fix (2026-08-24), `firm_splits` and
`block_sources` field-perm-checked resource `'shipment'`, where those keys can never appear
(`RESOURCE_FIELDS['shipment']` doesn't list them) — so every non-bypass role (everyone except
`admin`/`director`/`export_manager`) saw the cell as read-only in the Sheet even when granted
`shipment_firm_split`/`shipment_block_source` field or resource permissions (e.g.
`document_team`'s `shipment_firm_split: ['*']`).

### Customer-based row scoping (sales_rep)

A `sales_rep` user sees only the **shipment columns whose customer is assigned to them** (`Customer.sales_rep`, set via the Sales Rep Coverage endpoint). The `sheet()` action filters the queryset with `customer__sales_rep=request.user` whenever `request.user.role == 'sales_rep'` and they are not a superuser. Consequences:

- Shipments with a **null customer** are excluded for reps (no customer → no owner).
- A rep with **no assigned customers** gets an empty `results`.
- The filter also covers the `?shipment=<id>` drawer path, so a rep cannot open an unowned shipment (the single-row fetch returns an empty list).
- **Management** (`admin` / `export_manager` / `director`) and every **other operational role** (loading, transport, document_team, finansist, etc., who work by status phase, not customer) see all rows unchanged.
- The global config (`rows` / `row_settings` / `users_index` / `current_user_*`) is identical regardless of scoping — only `results` shrinks.

This mirrors the same ownership rule used by `GET /export/shipments/my-sales-reports/`. See [[../roles/sales-rep]].

> **Lifecycle timestamps are editable — they are the state machine's triggers.** AD-1 is retired: all ten (`loading_started_at` R19, `loading_ended_at` R20, `departed_at` R21, `customs_exit_at` R25, `border_crossed_at` R30, `dest_entry_at` R31, `customs_entry_at` R32, `arrived_at` R35, `sale_started_at` R41, `sale_ended_at` R42) are listed in `_ALL_PATCHABLE_FIELDS` in `ShipmentPatchSerializer`. Filling one resolves its step's task and `auto_advance_if_ready()` fires the transition — see [[../processes/shipment-lifecycle#Sheet-Driven Auto-Advance (v2)]]. `transition_to()` no longer writes any timestamp (`STATUS_TIMESTAMP_MAP` is empty).

## Save flow

`useShipmentPatch.ts` performs **optimistic updates with rollback**:

```
edit cell → setQueryData(... new value) → PATCH /export/shipments/{id}/ →
  ✓ success: invalidate ['shipments', 'sheet']
  ✗ error:   restore previous cache, show toast 'sheet.save_error'
```

Junction edits use a separate mutation that POSTs to `block-sources/` or `firm-splits/` and invalidates the same query key.

### Auto-split for R8 / R9 (Gap 7 — see ADR-016)

When the user picks blocks (R8) or firms (R9) in the multiselect, the frontend sends only the IDs — **`weight_kg` is omitted**. The backend fills the weights using two different rules because the two cells track conceptually different numbers:

| Cell | Rule |
|---|---|
| **R8 `block_sources`** (Soltanmyrat) | `(shipment.weight_net or 18,100) / N`, last entry gets the rounding remainder. Real harvest weight, no cap. |
| **R9 `firm_splits`** (Şulgun) | Lookup by N in `TruckSplitDefault` (admin-configurable). Defaults: 1→18,100 · 2→9,000 · 3→6,000. The OFFICIAL kg written on export documents — capped at 18,100 kg total per truck even though real trucks carry 20,000–21,000 kg. |

Director changes the per-firm-count amounts at `/admin/shipment-settings` → "Truck Split Defaults" tab. Cache invalidates on save so the next firm-split save uses the new value.

If the client sends an explicit non-zero `weight_kg`, the backend honours it (admin override path).

### Quota block on R9 `firm_splits` (no-quota firms rejected)

Assigning an export firm to a truck draws down that firm's government export quota, so a firm with **no remaining quota** may not be added to a split. This is a **hard block on both tiers**:

- **Frontend** (`SheetCellEditor` R9 multiselect): the editor fetches per-firm balances from `GET /export/quota-firm-balances/?product_type=tomato` (via `useQuotaFirmBalances`, enabled only on the `firm_splits` cell). Firms whose `remaining_kg <= 0` — including firms with **no allocation at all** — are shown with a `⚠ no quota` tag and rendered **`disabled`** so they cannot be picked. Only firms *not already on the split* are disabled, so an existing (over-committed) firm can still be **removed**. On commit, any no-quota firm that slipped through is stripped and an error toast fires (`sheet.firm_no_quota_error`). When the dropdown lists **at least one** such firm, the footer (beside *Done*) shows an **`Open quota page →`** link (`sheet.firm_no_quota_link`) to `/export/quota` — a disabled firm is otherwise a dead end. It is an anchor with `target="_blank"`, not an in-app `navigate()`: a same-tab route change unmounts the Sheet and drops the in-progress selection. Gated on `canSeePage(user, 'export.quota')`, which also passes for a user holding only the `export.quota.local_sell` child page — the same OR logic the route itself uses.
- **Backend** (`POST /shipments/{id}/firm-splits/`, `set_firm_splits`): re-checks server-side via `compute_firm_quota_balances('tomato')`. A **newly-added** firm (not in the shipment's current `firm_splits`) whose `remaining_kg <= 0` is rejected with `400 {"error": "<firms> has no remaining quota and cannot be added to the split."}` before any rows are written. Firms already on the split are exempt (they can be kept/re-saved while editing).

`product_type` defaults to **`tomato`** on both sides — the sheet payload carries no product type and pepper is a rare separate quota domain. `used_kg` in the balance is **committed** quota (draft + approved usage) so a firm can't be over-committed across many trucks before approval; see [[reference/quota]] / `compute_firm_quota_balances`. The **destination-draft modal** in this same screen is gated too (2026-08-23): its `ExportFirmSelect` rows take `checkQuota`, and `_create_draft_shipment` refuses a no-quota firm server-side with the identical 400 — with no "already on the split" exemption, since every firm on a new draft is newly added. The **join** flow (`POST /shipments/{id}/join/`) still does **not** enforce it: it merges splits that already exist.

## Per-cell color

Right-click any cell → **Cell color** opens a small modal with the ten shared `SHEET_PRESET_COLORS` swatches, a **Custom…** Ant `ColorPicker`, and **Clear color** (disabled when the cell has none). Picking a swatch saves immediately and closes the modal. The modal exists because an Ant `ColorPicker` nested inside the context-menu `Dropdown` closes the menu the moment its panel opens.

Storage is `SheetCellColor(shipment, field_key, color)` — one row per painted cell, unique on `(shipment, field_key)`, table `export_sheet_cell_color` (migration `export 0064`). Clearing **deletes** the row: an absent row IS "no color", so there is no second empty state. `field_key` is a plain `CharField`, not an FK to `SheetRowSetting`, because fallback rows from `DEFAULT_SHEET_ROWS` have no `SheetRowSetting` of their own; the endpoint validates the key against both sources on write.

Precedence, most specific first — **cell color > per-value color (FK / option) > `SheetRowSetting.style_color` (whole row) > `Shipment.column_color` tint (whole column)**. The first three are inline styles on the cell div, so any of them already beats the class-based column tint. Text color still comes from the WCAG auto-contrast helper unless the row sets `style_font_color`.

Permission: **open to every authenticated Sheet viewer**, exactly like the column tint. `POST /api/v1/export/shipments/{id}/set-cell-color/` with `{field_key, color}` is listed in `ShipmentViewSet._OPEN_ACTIONS`, so roles without `shipment.can_edit` (`accountant`, `weight_master`, `boss`, …) pass. Deleted / archived shipments are refused with 403. Unlike `column_color` this writes **no AuditLog** row — it lives in its own table rather than a shipment column, and a per-cell decoration would drown the value history the clock marker shows.

The sheet payload carries `cell_colors: { shipment_id: { field_key: "#RRGGBB" } }` (one extra query, no N+1), prop-drilled `ShipmentSheet → SheetGrid → SheetCell`. That chain is also the scope limit: `SheetCell` renders **only** inside `SheetGrid`, which only `ShipmentSheet` mounts, so a painted cell appears on the Sheet page alone — the Shipment Board / Self Kanban drawers render `SheetCellEditor`, which carries no background. `useSetCellColor` (in `useShipmentSheet.ts`) patches every cached query under `SHEET_QUERY_KEY` via `setQueriesData` for instant paint, snapshotting each for rollback on error.

## Per-shipment column color

Each shipment column header carries a small swatch button (top-right of the cell) that opens an Ant `ColorPicker`. The picked hex (`#RRGGBB`) is stored on `Shipment.column_color` (nullable `CharField(max_length=7)`); clearing the picker writes `null`. Sheet cells in that column then render with a tinted background (`color-mix(in srgb, var(--col-tint) 60%, var(--surface))`), and the header gets a 3px top border in the raw color so the flag is visible from the column-header row alone. For gapy-satys shipments the tint is mixed 75/25 over the gapy pink with `!important` so the operator's pick wins (white reads as white instead of disappearing into pink).

Permission: **open to every authenticated Sheet viewer.** The dot renders for any logged-in user (`canPaint = !!user`), and writes go through a dedicated `POST /api/v1/export/shipments/{id}/set-column-color/` endpoint listed in `ShipmentViewSet._OPEN_ACTIONS`. The viewset's `get_permissions()` override swaps `DynamicResourcePermission` for `IsAuthenticated` on that action, so roles without `shipment.can_edit` (e.g. `accountant`, `weight_master`, `boss`) still pass — column_color is a UI decoration, not domain data. (The field is also bypassed in `ShipmentPatchSerializer.validate()` as a defense for any code path that still PATCHes it via the shared shipment endpoint, e.g. `useShipmentPatchMulti` in the Edit Drawer.)

The picker has `disabledAlpha` to suppress the opacity slider, and the frontend defensively truncates the hex to 7 chars before saving so an older Ant build emitting `#RRGGBBAA` still fits the `max_length=7` column. Save flow uses the new `useSetColumnColor` hook (reuses `useShipmentPatch`'s exported `applyOptimistic` / `reconcileFromServer` / `rollback` for instant paint + rollback-on-error). Every value-changing write produces one `AuditLog` row (`field_name='column_color'`) via the standard sheet-PATCH diff-audit helper; the field is intentionally **not** in `DEFAULT_SHEET_ROWS`, so no clock-icon marker appears on any cell. The colour ships through `ShipmentSheetSerializer` as the `column_color` field.

## Supply-column tint

Columns created as **supply-only drafts** in the two-column Join flow are visually tinted so Gadam can spot them while assembling a shipment. The tint is driven by `created_by_role ∈ {loading_dept_head, warehouse_chief}` — the sheet endpoint items now carry a `created_by_role: string|null` field for this. A manual `column_color` (above) still **takes precedence** over the tint when set. See [[../processes/draft-shipments#Two-column Join flow (coexisting alternative)]] for the full creation + Join flow.

## Column reorder mode (global order)

Admin / export_manager can set a **global** left-to-right order for the shipment columns that every user then sees.

- **Entry**: the **Reorder columns** toolbar button (visible only when `user.is_superuser || user.role ∈ {admin, export_manager}`) toggles `reorderMode` in `sheetStore` (transient, not persisted; mutually exclusive with `joinMode`). While on, an inline banner explains the mode and offers a **Done** button.
- **Editing is locked**: with `reorderMode` on, `SheetCell` short-circuits click/double-click to edit, and the per-row Up/Down/drag + hide controls in the label column are disabled — the two reorder mechanisms (rows vs columns) never conflict.
- **Frozen columns**: while reordering, the effective `shipmentFreezeCount` is forced to `0` (computed in `SheetGrid`, store value untouched) so every shipment column lives in the single virtualized + sortable track and drags uniformly. The label band (#, Who, Field) keeps its freeze.
- **Drag**: column **headers** become dnd-kit `useSortable` items (`SortableHeaderWrapper`) inside a `DndContext` + `SortableContext` (`horizontalListSortingStrategy`, `autoScroll` enabled so dragging near an edge scrolls the virtualized track and reveals off-screen columns). Only the header is draggable; data cells follow because they map over the same ordered `shipments` array. `SortableContext` holds **all** shipment IDs even though virtualization renders only a subset. **Virtualization caveat**: because only the visible+overscan headers are mounted, dnd-kit's per-item "make room" transform must **not** be applied to in-list headers — the virtualizer owns their absolute `left`, and the two collide, leaving a stale duplicate header on drop (until refresh). So `SortableHeaderWrapper` applies no dnd-kit `transform`/`transition` (it only fades the source header while dragging), and the dragged column follows the cursor as a `<DragOverlay>` clone. Sibling columns therefore don't animate to make room mid-drag; the floating clone + drop is the feedback.
- **Optimistic + save**: on drag end, `arrayMove` produces the new id order → `sheetStore.columnOrder` is set optimistically (ShipmentSheet's `filtered` useMemo reorders by it, tolerant of stale/new IDs) → `useSaveSheetColumnOrder` POSTs the full id list. The page clears `columnOrder` after the next server refetch (guarded by `!reorderMode` so a background refetch can't yank the view mid-drag).

**Persistence**: `Shipment.sheet_position` (`PositiveIntegerField`, null, `db_index`) — sparse step `(idx+1)*1024`. The sheet queryset orders `F('sheet_position').asc(nulls_first=True), '-date', '-id'`: manually-placed shipments appear in saved order; brand-new shipments (NULL position) are the newest by date, so **NULLS FIRST** drops them at the top where `-date` naturally places the newest. No JSONField (MSSQL).

**Endpoint**: `POST /api/v1/export/shipments/sheet-order/` `{ "shipment_ids": [12, 7, 99, ...] }` → `200 { "updated": N }`. Server-side permission: `is_superuser || role ∈ {admin, export_manager}` (intentionally narrower than `PRIVILEGED_ROLES` — excludes `director` — to match the button gate); 403 otherwise. Validates list-of-ints, rejects duplicates; assigns positions via `bulk_update(batch_size=500)`; unknown ids ignored. The global order affects all users, so it is restricted to senior operators.

## Toolbar

- **Reorder columns** — admin / export_manager only; toggles the global column-reorder mode above.
- **Iberiş goş** (Add shipment) — **one-click** creation of an **empty** supply-only `draft` column (hook `useCreateEmptyColumn`, `POST {is_draft: true}`); no modal. The backend auto-generates `shipment_code` and defaults `date` to today; no blocks, variety, or destination. Soltanmyrat (`loading_dept_head`) then types the values directly into the Sheet cells and joins the column with Gadam's destination column later. Visible to `loading_dept_head` / `warehouse_chief` / `export_manager` / `director` / superuser. Replaces the former `SupplyDraftModal` (forecast-pool block picker), now removed. See [[../processes/draft-shipments#Two-column Join flow (coexisting alternative)]].
- **New destination shipment** — opens `DestinationDraftModal`; creates a destination-only `draft` column (country + import_firm + customer, optional firm_splits, no blocks). Used by Gadam (`export_manager`).
- **Join** — arms a **column-selection mode** (no modal): Gadam clicks two draft columns directly in the grid (highlighted with a blue ring); the `JoinActionBar` below the toolbar auto-detects the destination (target) vs supply (source), shows a preview, and confirms via Popconfirm. Merges the supply's blocks into the destination draft via `POST /export/shipments/{target_id}/join/` `{source_id}`; the source is hard-deleted on success. Visible to `admin`/`export_manager`/`director`/`boss` + superuser via the shared `canUserJoin()` in `joinHelpers.ts` — **until 2026-08-22 this button used a local `['export_manager','director']` list, so it was invisible to `admin` and `boss` even though the endpoint accepts them** (the Detail and List join surfaces already admitted both). When the selected pair is not joinable the bar now lists the **unmet requirements one by one** (`explainJoinBlockers()` → `join_blockers.*` i18n) instead of a single generic hint — e.g. *"D-1: fill in the Customer"*, *"Both columns have supply blocks"*.
- `+ Add column` — creates a new blank draft shipment (`useSheetCreate`); visible when `canDo('shipment', 'create')`
- Search — filters by `shipment_code`, `customer_name`, `export_code`, `driver_name`, `driver_phone`, or `truck_plate` (client-side)
- **🜔 Filters** — a `Popover` (button shows an active-count `Badge` and turns primary when any filter is set) housing all column filters: a **Gapy only** toggle (`is_gapy_satys = true`) plus single-select dropdowns for **Country**, **Customer**, **Import Firm**, **Export Firm**, and **Block**, with a **Clear all** button. State lives in `sheetStore` (`showGapyOnly` + `sheetFilters: {country, customer, importFirm, exportFirm, block}`, with `setSheetFilter` / `resetSheetFilters`). All matching is client-side in `ShipmentSheet`'s `filtered` useMemo: country/customer/importFirm match the numeric FK; exportFirm matches any `firm_splits[].firm_code`; block matches any `block_sources[].block_code`. Dropdown **options are derived from the full unfiltered payload** (`allShipments` prop) so the dimensions don't cascade, and only values actually present in the data are offered. When a filter is active the count reads `filtered / total` (`sheet.filtered_count`).
- **⚙ Settings** — opens the `Sheet Display Settings` modal with the freeze pickers (see Freeze panes above)
- **Zoom `−` / `%` / `+`** — scales the whole grid (cells **and** fonts) 60 %–150 % in 10 % steps; click the `%` to reset to 100 %. State lives in `sheetStore` (`sheetZoom`, with `zoomIn`/`zoomOut`/`resetZoom`/`setSheetZoom`) and persists per browser to `localStorage` under `ygt-sheet-zoom`. See [Zoom](#zoom) below.
- **⛶ Fullscreen** (toolbar right) — enters a distraction-free mode: the page pins itself over the entire viewport (`.sheet-page--fullscreen`, `position:fixed; inset:0; z-index:1000`), covering the AppLayout sidebar (z-index 100) and header (z-index 99). The toolbar itself is **unmounted** — only the grid plus a small floating circular **exit** button (top-right) remain. Exit via that button or the **Esc** key. State: `sheetFullscreen` in `sheetStore` (`setSheetFullscreen`/`toggleSheetFullscreen`) — **ephemeral** (not persisted; a per-session view choice), and force-reset on page unmount so navigating away can't leave the flag stuck.
- Deadline timer — global hour deadline indicator

## Backend payload

`ShipmentSheetSerializer` flattens 44+ fields including:
- `firm_splits` and `block_sources` (inline `SheetFirmSplitInlineSerializer` / `SheetBlockSourceInlineSerializer`)
- Quality doc booleans (`doc_azyk`, `doc_suriji`, `doc_hil`, `doc_kalibrowka`) — sourced from `quality.*` (related_name on `QualityDocument` is `quality`)
- `has_sales_report` — annotated by viewset queryset via `Exists(SalesReport.objects.filter(shipment=OuterRef('pk')))`
- `variety_code` from `TomatoVariety.code` (the official 01–10/E1–E3 registry code) — single-sort back-compat field
- `varieties_dominant` — array of `{id, code, name, is_experimental}` (1–4 entries). When a shipment carries more than one sort, the variety cell shows all of them joined (e.g. codes comma-separated). Backed by the existing `Shipment.varieties_dominant` M2M (no new table)
- Lifecycle timestamps — editable (they trigger the status advance)
- AD-2 fields — `vehicle_condition`, `vehicle_condition_note`, `route_note`

Querystring `?season=<id>` overrides the active season; default scopes to `season__is_active=True`.

### `/sheet/` response top-level keys (v2)

```json
{
  "results":          [ /* IShipmentSheetItem[] */ ],
  "comment_counts":   { "<shipment_id>": { "<field_key>": 3, "__shipment__": 1 } },
  "task_counts":      { "<shipment_id>": { "open": 2, "done": 5, "assigned_to_me_open": 1 } },
  "rows":             [ /* SheetRow config from DEFAULT_SHEET_ROWS — i18n keys + inputType + options_source */ ],
  "row_settings":     {
    "<field_key>": {
      "id": 12,
      "labels":            { "tk": "...", "ru": "...", "en": "..." },   /* only non-empty keys present */
      "description":       { "tk": "...", "ru": "...", "en": "..." },
      "style":             { "color": "#fff", "background": "#333" },
      "triggered_roles":   ["warehouse_chief", "document_team"],        /* from SheetRowRoleTrigger child table */
      "triggered_user":    42,                                           /* FK or null */
      "triggered_user_name": "Soltanmyrat",
      "triggered_user_active": true,
      "extra_user_ids":    [5, 8],                                       /* from SheetRowUserPermission (non-deleted) */
      "is_locked":         true,
      "is_visible":        true,
      "can_current_user_edit": false,
      "version":           3,
      "settings_updated_at": "2026-04-30T10:00:00+05:00",
      "settings_updated_by_id": 1
    }
    /* hidden rows (is_visible=False) are excluded entirely */
  },
  "last_edits":       { "<shipment_id>": { "<field_key>": { "user_id": 3, "user_name": "...", "old_value": "...", "new_value": "...", "edited_at": "..." } } },
  "users_index":      { "<user_id>": { "name": "Ahmet", "role": "warehouse_chief" } },
  "current_user_id":  3,
  "current_user_lang": "tk",
  "user_preferences": {
    "row_order":   [12, 5, 8],   // ids where user.position IS NOT NULL, ordered by position ASC
    "hidden_rows": [3, 14]       // ids where user.is_hidden = True
  }
}
```

**`users_index`** is a compact lookup map (`str(user_id) → {name, role}`) emitted once at root to avoid per-row user object repetition. Frontend uses it to resolve `triggered_user` and `extra_user_ids` without additional API calls.

**`current_user_lang`** is the request user's preferred language (defaults to `'tk'`). Frontend uses it to pick the right `labels[lang]` for the "Who" column and cell tooltips.

## Known issues

- **Role blocks are a view order only.** Grouping is applied client-side, so the `#` column (`global_position`) reads non-monotonically down a grouped sheet, and API consumers see the admin order. `finansist` (Babageldi) is a genuine one-row block today — no other who-key maps to that role — so it stays a singleton even after the 2026-08-24 person→role fix that merged the other small blocks (mergen into transport, aganazar into export_manager). Collapsing a block is not implemented. Since 2026-08-27, `WHO_KEY_ROLE`/`role_group` no longer needs a code change for a reassignment — see "Admin-managed role groups" above — but a genuinely NEW field on a NEW row still needs one, until an admin sets its `role_group`.
- **Aganazar's role was wrong for one day.** The 2026-08-24 fix inferred `sales_rep` from the one tail row he owns (`sales_report_date`) rather than checking `backfill_sheet_row_defaults.WHO_TO_ROLE`, which already had this exact mapping confirmed with the user 2026-06-02 as `export_manager`. Corrected 2026-08-27, same day the admin-manageable `role_group` shipped. Lesson: a confirmed org-chart decision outranks an inference from a single field's content.
- **Pinned rows shrunk from 13 to 5, field-key-based now (2026-08-27).** Reported by the owner directly against a live screenshot: `vehicle_condition`, `documents_status`, `transport_docs_given_at` and 4 others sat unbanded at the top despite having a `role_group` set, because they were pinned purely by POSITION (`IDENTITY_ROW_COUNT = 13`), not because they needed to be. `PINNED_FIELD_KEYS` now names exactly the 5 fields that must stay visible (`shipment_code`, `country`, `customer`, `city`, `import_firm`); everything else groups normally. Required three coordinated changes, not just the row set: `groupRowsByOwner` switched from slicing a prefix to filtering by field-key (the 5 pinned fields are not contiguous in server order), `markRoleBands`'s `startIndex` switched to the dynamic `pinnedPrefixLength(rows)`, and `DEFAULT_FROZEN_ROW_COUNT` dropped from 13 to 5 with a `localStorage` key bump (`-v2` → `-v3`) — without that last part, a band still couldn't render above row 13 for anyone who'd ever touched the freeze picker, since the live frozen-row setting would keep dominating `max(pinnedPrefixLength, frozenRowCount)`.
- **Sheet row keys were `row_number`, which is not unique — found verifying the above.** Five field_key pairs in the live data share a `row_number` (e.g. `is_gapy_satys`/`firm_contracts` both 47, `notes`/`transport_docs_given_at` both 4) — a legacy artifact of `row_number` being superseded by `display_order` while never being re-deduplicated. `SheetGrid.tsx`'s row `<Fragment key={...}>` used `row_number`, so React logged a duplicate-key warning and, worse, could reuse/drop the wrong row's DOM node across a re-render. Switched to `field_key`, the model's actual `unique=True` identity. Unrelated to the pinning change; fixed in the same pass because it surfaced in the same console check.
- **A saved personal row order permanently hides role blocks — most-used accounts get bitten first.** `groupRowsByOwner` never runs for a user with `user_preferences.row_order` non-empty (see above), and both the real `admin` and `export_manager` accounts already had one saved from ordinary drag-and-drop use before this feature shipped — so the two accounts most likely to test it saw no change at all, reported 2026-08-24. Fixed with a "Reset to role blocks" button in the Sheet settings modal (`SheetToolbar.tsx`, `sheet.settings.row_order_section`) — visible only when the signed-in user has a personal order — that PATCHes `row_order: []`. There is still no bulk/admin-side way to reset every user at once; each person resets their own from their own settings modal.
- All rows from R2 to R44 are now configured (R24 is the new finansist doc-advance flag).
- **`truck_capacity`, `product_date`, `transit_days_temp`** — present in `sheetRowConfig.ts` but not backed by a model field in `_ALL_PATCHABLE_FIELDS`. They render but plain cell edits would 403. (`transit_days_temp` is a virtual key — its perm gate delegates to `transit_days` and saves dispatch to both real fields; see R26 above.) The previously-listed `harvest_date`, `additional_notes_arap`, `truck_plate`, `driver_name`, `driver_phone` are now real `Shipment` columns in `_ALL_PATCHABLE_FIELDS` and edit normally.

**`truck_plate` — fleet head+trailer picker (SP3b).** Although its `input_type` is `'text'`, `SheetCellEditor` special-cases `field_key === 'truck_plate'`: for a **non-gapy** shipment it renders `SheetTruckSelectEditor` (a two-select overlay — truck head + trailer — from the company fleet, with inline "+ Add", portaled to `document.body` so the cell's `contain: layout paint` doesn't clip it) and saves `truck_head_id` + `trailer_id` + a derived `truck_plate = "{head}/{trailer}"` in **one** `patchMultiMutation` with Sheet undo capture. For a **gapy_satyş** shipment it stays the plain text `<Input>` — no selects, no GPS (local buyers' trucks aren't in the fleet). Picking a head auto-resolves the shipment's GPS device. See [[../processes/fleet-map#Shipment truck selectors (SP3a / SP3c / SP3b)]].

**`driver_name` — driver registry picker (2026-08-20).** Same shape one row down. `input_type`
stays `'text'`, and `SheetCellEditor` special-cases `field_key === 'driver_name'`: for a
**non-gapy** shipment it renders `SheetDriverSelectEditor` (one select over the `Z_TIRWEB`
driver registry, active-only, with inline "+ Add", portaled the same way) and saves
`driver_id` + `driver_name` in **one** `patchMultiMutation` with Sheet undo capture. For a
**gapy_satyş** shipment it stays the plain text `<Input>` — local buyers bring their own truck
*and* their own driver, so picking from the company registry there would pollute it.

The same picker (`components/DriverSelect.tsx`) also backs the ShipmentDetail transport card and
the edit drawer via `ShipmentDriverSelector`, so the three surfaces cannot disagree about
`driver_id` — see [[../processes/fleet-map#Shipment driver selector (2026-08-20)]].

**R28 `driver_phone` is written by that picker only when the registry actually holds a number**
(`driverPatchFields()` in `components/DriverSelect.tsx`). Z_TIRWEB supplies no phones at all,
while 80 of the 146 shipments carry one an operator typed by hand — so a blank registry value
is omitted from the patch entirely rather than erasing their work. A real registry phone is
newer information and does replace what is there. Clearing the driver leaves R28 alone for the
same reason. Operators can fill a driver's phone once in the Fleet Admin Drivers tab and it
then follows that driver onto every future shipment. Inline-added driver names are upper-cased to match how the registry stores all 152
rows, so a re-type doesn't create a near-duplicate.

**R39 `harvest_date` (Ýygylan senesi)** is a **free-text** cell (`input_type='text'`), not a date picker. `Shipment.harvest_date` is a `CharField` — operators type whatever form the operation uses (a single day, a range like `5–10 oktýabr`, or a note). The earlier multi-block per-`block_source` calendar editor was removed; the vestigial `ShipmentBlockSource.harvest_date` column is no longer read or written by the Sheet.

## Related

- [[../processes/shipment-lifecycle]] — How filling a timestamp cell advances the status
- [[../processes/permissions-system]] — Dynamic permission registry, `canEditField` / `canDo`
- [[../reference/api-endpoint-map]] — `GET /export/shipments/sheet/` and the inline patch contract
