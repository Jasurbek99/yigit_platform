---
title: Detail vs Sheet — process flow comparison
tags: [process, shipment, detail, sheet, comparison]
related: [[shipment-lifecycle]], [[comments-tasks]], [[../screens/shipment-list-vs-sheet]], [[../screens/shipment-sheet]]
---

# Detail vs Sheet — process flow comparison

Same data, two surfaces. The Sheet is the "Excel replacement"; the Detail page is the "everything about this one shipment" view. Since 2026-09-30 both show every Sheet field — but the workflow they optimise for is different.

This doc walks through how a shipment is actually worked on through each surface, then contrasts them.

---

## Part 1 — Working a shipment on the **Detail page**

URL: `/shipments/:id` (rewritten 2026-09-30 — spec `docs/superpowers/specs/2026-09-30-shipment-detail-full-design.md`).

Since 2026-09-30 the Detail page shows **every Sheet field** and lets you work all **three parts** of a shipment (transport / packaging / export — see `docs/SHIPMENT_THREE_PARTS_RU.md`) without leaving it.

### What you see when you open it

Top to bottom:

1. **Hero** — Shipment Code, Export Code, status, phase, idle / freshness tags, actions (comments, Manifest, QR label, Promote, **Join supply**, Transition, Cancel).
2. **Guidance line** and **completeness bar** — every key in `completeness.missing_fields` (from `TaskRule.target_fields`) is a chip that jumps to its row or card. An acceptance test (`components/shipment/detailCoverage.test.tsx`) proves every seeded task target has a place to land.
3. **Stage cards** (two columns on desktop, one on mobile):
   - **Destination** — country, customer, city, import firm, gapy flag, export firms, and the **contracts panel** per firm (contract number, link a framework contract, create a one-time one, .docx). The panel shows once a firm is picked.
   - **Transport (transport part)** — regular shipments: the Planning trip banner, **«Выбрать рейс»** (free trips, country must match, unknown country asks first; only in Preparation, only with the Truck Board grant + `shipment_assign.edit`), **«Отвязать»** on the banner. Truck and driver are read-only (they come from the trip). Gapy: typed truck and driver. Then driver phone, vehicle responsible/condition, transit days, temperature, border point, live position, transport docs given, shelf life, second rig, greenhouse arrival/departure, border exit, country entry, peregruz (Да/Нет, time, city), arrival.
   - **Loading (packaging part)** — export code, blocks, **«Отсоединить» / «Поменять упаковку»** (before loading; unjoin needs a destination), harvest status, variety, net, weight to load, harvest date (as Sheet R39: block batch dates first, else the shipment's own text), loading start / end.
   - **Documents** — documents status, planned customs day, documents note, TM customs closed, destination customs passed, advance given, and the **packing panel** (packing template → whole-truck gross/net/boxes for the CMR, per-firm gross/boxes/pallets).
   - **Notes** — legacy notes, Gadam's / warehouse / Arap notes, and every admin **custom Sheet row**.
   - **Quality** — the four certificate uploads.
4. **«Документы — печать»** — the truck's whole document packet, as a Documents-page row: readiness banner, ZIP, CMR, TIR carnet, each firm's invoice / letters. Printed in-page; visible with the `sale` grant. The readiness banner says «fill on this page» and links each missing item to its row; a regular truck's missing driver/plate show as one «choose a Planning trip» link to the trip block.
5. **Sale** — price, total, sale start / end, report date, firm splits, sales report.
6. Quota, customs expenses, GPS cards; link to the activity log.

Gross / tare / pallets / boxes are **not** editable rows on Detail any more: the CMR reads the packing template first, so an edit there was silently ignored. They are entered in the packing panel. The Edit drawer and the pallet manifest still write the shipment columns (CMR fallback when no template).

### Field permissions on Detail

Rows are editable whenever the page is editable for you (page-level grant + open season). `DetailFieldRow` does not check per-field grants — a role without a field's grant sees the row editable and gets an error toast when the backend refuses the PATCH. Trip actions, packing actions and the print card are gated by their own grants (see above).

### When to use Detail

- You work on **one shipment** end to end: choose its truck, move its packing, settle gross/net, link contracts, print its documents.
- You follow a completeness chip from a task.
- You need to **promote a draft**, read the route timeline, or the activity log.

---

## Part 2 — Working a shipment on the **Sheet**

URL: `/export/shipments/sheet`

### What you see when you open it

An Excel-like grid for the **active season**:

- **Rows** are field categories (~46 rows for the operational-shipment view): truck status, additional notes, Gadam's note, documents status, Export Code, blocks, customer, country, weight_net, weight_gross, etc. Plus admin-defined custom rows.
- **Columns** are individual shipments. Each column is one shipment; the column header shows a sequence number, the Export Code (full `DDMMNNN/YY`), and the status.
- **Cells** at the intersection of (row, column) are the field's current value for that shipment.

The frozen left band shows row labels and the "Who" (responsible role) column. The first N shipment columns are also frozen by default so you can keep your eye on a key shipment while scrolling through 200 others.

### Process: how a warehouse_chief acts here

User opens the Sheet. Walkthrough:

1. The `weight_net` row is at row 37 (or wherever the user pinned it via per-user preferences). User scrolls horizontally to the column for shipment `0205893/26`.
2. User clicks the cell at (`weight_net`, `0205893/26`). The cell flips into edit mode — an inline `<InputNumber>` with the current value selected. Same look as the Detail page's editor but more compact.
3. User types `18900`, presses Enter or Tab. The cell saves (server PATCH), exits edit mode, the new value renders.
4. User wants to fill weight_net for **5 different shipments** in a row. They click each cell, type, Enter, click next, type, Enter — same row, different columns. Sheet stays in place; no navigation. This is the Sheet's superpower.
5. User notices a comment indicator on a cell. Clicks the indicator → the Comments Drawer opens, scoped to that shipment + that field. They reply, mark a task done, close.
6. User wants to bulk-toggle quality docs across 10 shipments. Each `quality.*` row is a Boolean cell — click to toggle. Done in 30 seconds.

### Tasks on the Sheet

The Sheet has no per-task cards. Instead:

- The toolbar shows an "open tasks assigned to me" badge with the count (sum across all shipments visible).
- Per-cell **comment counts** and **task indicators** appear as small markers on the cell. Clicking opens the Comments Drawer for that cell.
- Tasks are still being created and resolved by the same server-side rule engine — the Sheet just doesn't surface the "what task is this and who owns it" UI. It surfaces the **field values** and lets people fill them.

### When to use Sheet

- You are filling the **same field across many shipments** — bulk loading, document review, weight checks, status flips.
- You want the **bird's-eye view** of the active season.
- You are leaving comments or assigning ad-hoc cell-anchored tasks.
- You are a `warehouse_chief` or `document_team` member on a busy day with 30+ shipments in motion.

---

## Part 3 — How the two surfaces differ

### Logical model (what data is rendered)

Same `Shipment` model. Different serializers, different concerns:

| | Detail page | Sheet |
|---|---|---|
| Endpoint | `GET /api/v1/export/shipments/{id}/` | `GET /api/v1/export/shipments/sheet/` |
| Scope | One shipment, full payload | Every shipment in the active season |
| Pagination | N/A — single record | None — full season array |
| Per-user prefs | None | `UserSheetRowPref` (which rows hidden, what order) |
| Includes tasks? | `my_task` + `other_tasks` in the payload (not rendered) + `completeness` chips | Only counts (`task_counts[shipment_id]`) per shipment column |
| Includes comments? | Inline `comments[]` array on the payload | `comment_counts[shipment_id][field_key]` markers per cell |
| Includes timeline? | `status_log[]` array (used by RouteTimelineRail) | Not in the Sheet payload — Sheet doesn't show timelines |
| Includes phase context? | `in_phase_seconds`, `phase_avg_seconds`, `can_promote_from_draft` | Not — Sheet's column header just shows status |
| Read pattern | TanStack `['shipment', id]`, refetch on save | TanStack `['shipments', 'sheet']`, refetch on save |

### Save path — same hook, same endpoint

Both surfaces dispatch through `useShipmentPatchMulti` (after Stream G; previously Sheet used `useShipmentPatch` and Detail used a per-section custom mutation, but that was unified). Both hit `PATCH /api/v1/export/shipments/{id}/`. The serializer is shared — the same `_ALL_PATCHABLE_FIELDS` filter, the same per-role permission gate, the same `Shipment.save()` post-save hooks (resolve tasks, etc.).

When you save on Detail, the optimistic cache update on `['shipments']` ALSO refreshes the Sheet's data on next render — a value typed on Detail will appear on the Sheet (within a render cycle) and vice versa.

### Process model (workflow optimisation)

| Aspect | Detail page | Sheet |
|---|---|---|
| **Optimal use** | Deep work on one shipment | Wide work across many shipments |
| **Navigation cost** | One click from List or kanban → full context for that one shipment | One click from sidebar → see entire season at once |
| **Edit interaction** | Click cell → inline editor, debounced save (700 ms text / immediate Select) | Click cell → inline editor, save on Enter / blur |
| **Task awareness** | Completeness chips jump to each owed field | Implicit — task counts shown on cells, no per-task UI |
| **Cross-shipment compare** | Hard — page is one shipment | Trivial — columns are side by side |
| **Status transitions** | Hero buttons (Manifest, Promote, Transition) | Not exposed — go to Detail to transition |
| **Comments / threads** | Activity log page (`/shipments/:id/activity`) | Per-cell drawer + filter chips |
| **Right-rail timeline** | Yes (12-step route) | No |
| **Bulk operations** | One field at a time | Excel-like — fill down a row, paste a column |
| **Mobile-friendly** | Yes (right rail collapses, single column) | Limited — narrow viewports lose horizontal context |

### Logical asymmetries to remember

1. **Choosing the truck, moving packing and printing documents now work on both** — Detail has them in-page (trip picker, unjoin/swap, print card); the Sheet / Truck Board / Assignment Board / Documents page keep their own entry points. Same endpoints underneath.

2. **Promote to Loading button only exists on Detail.** Drafts can be edited on the Sheet (Shipment Code, blocks, customer, etc.) but the "ready to promote" check (`can_promote_from_draft`) and the button live on the Detail Hero. To advance a draft, you must visit Detail.

3. **The right-rail timeline has no Sheet equivalent.** If you need to see when a shipment hit each status, that's Detail-only.

4. **Comments anchored to a cell** are visible on both surfaces but the editing experience differs:
   - On Sheet: click the indicator → small Drawer scoped to that cell.
   - On Detail: comments appear under the activity log page, organised by shipment-level and field-level. Cell-anchor jumps from notification deeplinks open the Sheet's Drawer, not Detail.

5. **Custom rows (admin-created in Phase 5c)** show on both: the Sheet as rows, Detail in the Notes card (`custom_fields` on the detail API, written through `PATCH /shipments/{id}/custom-fields/`).

### Process asymmetries to remember

1. **Soltanmyrat's typical day.** Open Sheet, scroll to today's columns, fill weight_net + Shipment Code on each in succession, flip harvest_status checkboxes, leave. Detail rarely opens unless a specific shipment is escalated.

2. **Gadam's typical day.** Open the Self Kanban first (`/me/board`) to see his queue. For each task, click the card → lands on Detail → handles that one shipment's prep tasks (set destination, pick firms). When he wants to oversee, opens the Shipment Kanban (`/export/shipments/board`) for the phase view.

3. **Sirin's typical day.** Mix of both. Sheet for `documents_status` flips across many shipments, Detail when she needs to read the route history or unblock a colleague's task.

4. **A new shipment's first hour.**
   - Created via Sheet "+" button or List modal → lands as Draft, no `loading_started_at`, no Shipment Code.
   - The 5 draft tasks generate immediately (set destination, pick firms, assign driver, give documents, start documents prep).
   - Each role gets the new task in their `/me/board` and sees the shipment's Sheet column appear at the right edge.
   - Roles fill their fields — equally well from Sheet (cell-by-cell) or from Detail (task-card-driven).
   - When all auto-resolving draft tasks are DONE, `can_promote_from_draft` flips to true, the Promote button appears on Detail, Gadam clicks it.
   - Shipment transitions to yuklenme; `loading_started_at` is written by `transition_to`; the Loading-stage tasks (fill_loading_data, quality_inspection) generate. Soltanmyrat picks them up from the Sheet column or his Self Kanban.

### Data flow on save (annotated)

User edits `weight_net` on Detail:
- `<DetailFieldRow>` debounces 700 ms.
- `useShipmentPatchMulti.mutate({id, fields: {weight_net: 18900}})` fires.
- Backend `PATCH /api/v1/export/shipments/123/` validates: role allowed to edit `weight_net`? yes. Calls `serializer.save()` → `Shipment.save()`.
- `Shipment.save()` runs `resolve_for_shipment(self)` — checks every open/in_progress task on this shipment. The `tasks.fill_loading_data` task targets `[shipment_code, block_sources, variety, weight_net, weight_gross]`. If all five are now non-null, mark task DONE.
- View also calls `mark_started_for_changed_fields(shipment, ['weight_net'])` — finds OPEN tasks targeting `weight_net`, flips them to IN_PROGRESS with `started_at = now()`.
- React-query `onSettled` invalidates `['shipments']` (Sheet, list views) and `['shipment']` (Detail). Both surfaces refetch.
- Optimistic cache update means the user sees the new value immediately; the refetch confirms and adds the task state changes.

User edits the same `weight_net` on Sheet — exact same flow. Different React-query key gets the optimistic update first, but the same backend code runs and both views end up consistent.

---

## Decision matrix

| If you want to… | Use |
|---|---|
| Fill the same field across 10 shipments | **Sheet** |
| Move a draft to Loading | **Detail** (Promote button) |
| Choose / unlink the Planning trip of one shipment | **Detail** (Transport card) or the Truck Board |
| Unjoin / swap packing of one shipment | **Detail** (Loading card) or the Assignment Board / Sheet |
| Print the CMR / TIR / invoices of one truck | **Detail** («Документы — печать») or the Documents page |
| Triage your own task queue across all shipments | `/me/board` (then click into Detail) |
| See the season at a glance — which phase, which stuck, which late | `/export/shipments/board` (Shipment Kanban) |
| Read the full status timeline for one shipment | **Detail** (right rail) |
| Read or post comments anchored to a specific cell | **Sheet** (Comments Drawer) |
| Read the activity log (status changes + shipment-level comments) | `/shipments/:id/activity` (linked from Detail) |
| Edit admin-defined custom rows | **Sheet** or **Detail** (Notes card) |
| Promote a draft to Loading once prep is done | **Detail** (button) |
| Override the variety of a shipment | **Detail** (Variety section) |
| Generate / regenerate the Export Code | **Nothing** — auto-generated server-side |
| Type the physical Shipment Code | Either — same field, same backend |

---

## Operational summary

- **Detail = depth.** Everything about one shipment in one screen. Use when you want to focus.
- **Sheet = breadth.** Same data, organised by field × shipment. Use when you want to multitask.
- **Both write to the same fields through the same backend.** Saves on one show up on the other within a render cycle.
- **Tasks are the connective tissue.** They live in the database, get generated by the rule engine on status entry, surface differently on each screen (cards on Detail, counts on Sheet, full lists on `/me/board`), but the auto-resolution logic is the same regardless of which screen the user typed in.
