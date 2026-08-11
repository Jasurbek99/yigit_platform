# TIR Fleet Integration — SP3/SP4 Handoff

**Date:** 2026-08-10
**Branch:** `feat/transport-fleet-map` — **lives in the worktree** `D:/projects/yigit_platform-transport-fleet-map` (the main dir `D:/projects/yigit_platform` is on another session's `feat/season-lifecycle`). ~49 commits ahead of main. **NOT pushed** yet.
**Design spec:** `docs/superpowers/specs/2026-08-03-tir-fleet-integration-design.md` (read this first).

## Done (backend complete, all reviewed + merge-approved)
- **SP1** (`…-subproject1.md`): `TruckHead`/`Trailer` models; `import_tir_fleet` (one-time, read-only pyodbc from Z_TIRWEB, id-preserving, plate-matches Traccar devices, idempotent); resolver upgraded to **manual `ShipmentDeviceLink` → `truck_head_id` → plate-match → none**.
  - **The import was RUN** against the dev DB: **91 truck heads (90 GPS-linked), 74 trailers**, ids 13–211 preserved.
- **SP2** (`…-subproject2.md`): `TruckHeadViewSet` + `TrailerViewSet` — `GET/POST/PATCH /api/v1/transport/truck-heads/` and `/trailers/`. List = active-only, `IsAuthenticated`; create/update gated to `CanEditShipment`; `?search=`; `has_gps`; **`device_for_plate()`** (single shared source w/ Cyrillic guard) plate-matches a device on create AND on plate-PATCH. `traccar_device` not client-writable.

## Remaining — SP3 (shipment selectors) + SP4 (admin page)

**HARD RULE (user emphasized twice):** if `shipment.is_gapy_satys` is **true**, the truck field stays a **plain text input** and shows **no GPS** — those are local buyers' trucks, not the company fleet. Only non-Gapy-Satys shipments get the fleet dropdowns.

### SP3a — edit-drawer selectors (do first; well-trodden)
- Backend ready: `truck_head_id`/`trailer_id` are already in `_ALL_PATCHABLE_FIELDS` (`export/serializers.py:1444`) and the shipment serializer.
- The drawer uses a declarative field config: `frontend/src/constants/shipmentEditConfig.ts` — `inputType: 'select'` with `optionsSource` (see `country`/`customer`/`import_firm`; **`driver_id` already maps a `select` → an id via `optionsSource: 'transportUsers'`** — mirror that).
- `OptionsSource` union is in `shipmentEditConfig.ts:23`. Find where the drawer resolves `optionsSource → data` (the options provider feeding `DetailFieldRow.tsx`; `TaskCardEditor.helpers.ts` also maps sources) and add `truckHeads`/`trailers`.
- New hooks: `useTruckHeads()` / `useTrailers()` → `GET /transport/truck-heads/` + `/trailers/` (mirror `useTransportDevices.ts`). Options = `[{value: id, label: plate_number}]`.
- Replace the transport-section `truck_plate` text field with `truck_head_id` + `trailer_id` selects **when `!is_gapy_satys`** (keep the text field when `is_gapy_satys`). On save, PATCH the two ids **and** set `truck_plate = "{head}/{trailer}"` — use `useShipmentPatchMulti()` (`hooks/useShipmentPatch.ts:259`).
- GPS then resolves automatically (resolver's `truck_head_id` step) and the ShipmentDetail truck card lights up.

### SP3b — Sheet cell (harder)
- `truck_plate` is a plain-text cell (`components/sheet/getCellValue.ts`, custom grid). Make it the same truck_head/trailer picker (text when Gapy Satys). This is the non-trivial grid-cell-editor piece — plan it separately.

### SP3c — inline "+ Add" (create-if-not-in-list)
- User wants both inline-add AND the admin page. The `POST` endpoints already exist. Inline-add = a custom AntD `dropdownRender` "+ Add \"<plate>\"" → `POST /transport/truck-heads|trailers/` → refetch → select. Optional add-on to SP3a's selects.

### SP4 — admin management page
- List/create/edit/deactivate TruckHead + Trailer. Mirror an existing admin page (e.g. `pages/admin/TruckDestinationsPage.tsx`). Endpoints from SP2 already cover it.

## Outstanding / follow-ups (from reviews, tracked)
- **Rotate the `tirweb`/`tirweb` Z_TIRWEB creds** before pushing — they're in earlier unpushed local history + on `feat/season-lifecycle`. Import is one-time + done, so nothing runtime depends on them.
- **Push is held** until the whole feature is done + creds rotated.
- Import doesn't re-link devices registered *after* the import (only the create/PATCH endpoints do) — fine until a re-import.
- `import` builds its plate→truck index without an `is_active` filter (resolver's plate path filters `is_active=True`) — minor inconsistency, ticket.
- `owner_name` (Cyrillic collation) search has no test.
- **TICKET (SP4 review):** renaming a fleet plate on `/admin/fleet` leaves `Shipment.truck_plate` stale on shipments already carrying the old `"{head}/{trailer}"` string. The id link (`truck_head_id`) stays correct so GPS still resolves — only the denormalized display text goes stale. Back-propagate on rename, or recompute `truck_plate` on read. Non-blocking.
- **TICKET (SP3c review):** backport the `searchValue`-clear-on-select fix (stale "+ Add" → garbage create) to `CitySelect.tsx`/`CountrySelect.tsx` (superuser/director-gated, so lower blast radius).

## SDD ledgers (gitignored scratch, main dir)
`.superpowers/sdd/2026-08-03-tir-fleet-subproject1/progress.md` and `…-subproject2/progress.md` — full task-by-task history if resuming in the same machine/session.

---
## UPDATE 2026-08-10 — SP3a DONE
SP3a (edit-drawer selector) shipped + Opus-approved: `useFleet.ts` hooks, `ShipmentTruckSelector.tsx`, injected into `ShipmentTransportBody.tsx` (ShipmentDetail) AND `ShipmentEditDrawer.tsx` (list row-edit + dashboard slide), both gated on `is_gapy_satys` (→ text). Commits `e4fb50f..a8479d5`.
STILL REMAINING: SP3b (Sheet cell — `SheetCellEditor.tsx` getOptions switch + custom grid editor for truck_head/trailer, still text when gapy), SP3c (inline "+ Add" via dropdownRender → POST), SP4 (admin CRUD page). Push still held pending tirweb cred rotation.

---
## UPDATE 2026-08-11 — SP3c + SP4 DONE
- **SP3c DONE** (Opus-approved): inline "+ Add" in `ShipmentTruckSelector` (`dropdownRender` → POST → select), plate uppercased, stale-search-clear fix. Commits `…7795fcb`.
- **SP4 DONE** (reviewed, CRITICAL fixed + test-proven): admin page `/admin/fleet` (`FleetAdminPage.tsx`, Trucks/Trailers tabs — list incl. inactive, create/edit/activate-deactivate), `?include_inactive=true` list param, `useFleetAdmin.ts` hooks (incl. single-call admin create), `owner_name` field+column. Plan: `docs/superpowers/plans/2026-08-10-tir-fleet-sp4-admin-page.md`. Commits `44a2666..bdc725a` (incl. `d7bac43` = CRITICAL GPS-device-wipe-on-edit fix, `ce61029` = owner_name-preservation regression test). Obsidian vault updated (`af1b5aa`).
- **STILL REMAINING: only SP3b** (Sheet-cell truck/trailer picker — needs a grid-cell design decision; text when `is_gapy_satys`).
- Branch state: `feat/transport-fleet-map`, ~66 commits ahead of main; remote at `1599777` (SP3c + SP4 = 11 commits UNPUSHED). Push still held pending user go-ahead.
