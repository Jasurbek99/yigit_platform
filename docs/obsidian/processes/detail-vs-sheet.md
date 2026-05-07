---
title: Detail vs Sheet — process flow comparison
tags: [process, shipment, detail, sheet, comparison]
related: [[shipment-lifecycle]], [[comments-tasks]], [[../screens/shipment-list-vs-sheet]], [[../screens/shipment-sheet]]
---

# Detail vs Sheet — process flow comparison

Same data, two surfaces. The Sheet is the "Excel replacement"; the Detail page is the "what should I do next on this one shipment" view. After Stream G + the Detail-usable fix, both let you edit every operationally-relevant field — but the workflow they optimise for is different.

This doc walks through how a shipment is actually worked on through each surface, then contrasts them.

---

## Part 1 — Working a shipment on the **Detail page**

URL: `/export/shipments/:id`

### What you see when you open it

A single-column layout (sticky right rail on desktop), top to bottom:

1. **Hero bar** — Shipment Code (top, bold), Export Code (small, below), status pill, phase tag, idle warning if the shipment has been in this phase longer than the historical average × 1.5, FreshnessPill (today / yesterday / aged), and right-aligned action buttons (Manifest, Promote to Loading when applicable, Transition).
2. **MyTaskCard** — the user's currently-assigned task on this shipment (one card, prominent). Renders only when the requester has an active task. Supervisors see no card here — they see no task and no banner. Other operational roles with no task but other tasks active see a soft "{N} tasks with other roles. You'll be notified when it's your turn."
3. **PhaseContextStrip** — three small cells: "In phase: 2d 4h" / "Avg for step: 1d 12h" / "Tasks open: 2/5".
4. **OtherTasksRow** — a clickable list of every other task on this shipment, with state icon + role label + deadline.
5. **Five collapsible sections** — Logistika / Ulag / Haryt / Dokument / Maliýe. All expanded by default. Each section has labeled rows of inline editors plus any special widgets (variety override, firm splits table, quality checkboxes, sales report form).
6. **Right rail** (≥md): 13-step status route timeline (visually unchanged from before, mapped by `status_code` not array index).
7. Below the collapse, a single "View activity log" tag links to `/shipments/:id/activity`.

### Process: how a warehouse_chief acts here

User logs in, opens a `yuklenme` shipment. Walkthrough:

1. **Hero shows status = Loading, phase = LOAD, idle warning = no.** The Shipment Code says "—" because Soltanmyrat hasn't tagged the pallets yet; the Export Code is `0205893/26` (the auto code).
2. **MyTaskCard renders the `tasks.fill_loading_data` task.** Title visible, deadline 4h after status entry, progress bar shows "0 of 5 fields filled." The card body has 5 inline editors for cargo_code, block_sources, variety, weight_net, weight_gross.
3. User starts typing in `weight_net`. After ~700 ms the autosave fires; the spinner blinks; the value persists. Critically, the input is NOT disabled during the save — typing keeps working.
4. As fields fill, the progress bar updates. After the 5th field saves, `Shipment.save()` triggers `resolve_for_shipment` server-side; the task auto-resolves to DONE; `MyTaskCard` re-renders showing the "Done" tag.
5. User scrolls down to the **Haryt** section to verify variety, **Dokument** to flip quality checkboxes, **Maliýe** to skim weight totals. Every editable field in those sections uses the same `<DetailFieldRow>` widget — same UX as MyTaskCard.
6. The Shipment Code in the Hero is still empty. User opens the **Logistika** section, types the physical pallet tag in the Shipment Code row, tabs out. Saves on blur. The Hero re-renders with the new code on the top line.
7. User leaves. Next time the page loads, this shipment may be in `gumruk_girish` (document_team picked it up); MyTaskCard now empty for warehouse_chief; OtherTasksRow shows "Send documents to customs" being worked on by Sirin.

### What clicking a task in OtherTasksRow does

Stream G fix #4 made these rows interactive:

- Click an OPEN task → the page expands the section containing the task's first target field, smooth-scrolls to that row, focuses the input. If the current user matches the task's `assignee_role`, also fires `POST /tasks/:id/start/` so the state flips to IN_PROGRESS.
- Click a DONE task → expands the section, scrolls. Fields are read-only for non-assignees but visible for review.
- Click a BLOCKED task → opens a modal with `blocked_reason` and an Unblock button (gated to the assignee_role or supervisors).

### When to use Detail

- You are working on **one shipment** and need full context — the task you own, what other roles are doing, the timeline, every field, the activity log.
- You are a **supervisor** wanting to see how a single shipment is progressing.
- You need to **promote a draft** — the "Promote to Loading" button only appears here.
- You need to **review history** — the right-rail timeline + activity log live here.

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

The Sheet doesn't have a MyTaskCard or OtherTasksRow. Instead:

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
| Includes tasks? | `my_task` + `other_tasks` (full TaskListSerializer rows) | Only counts (`task_counts[shipment_id]`) per shipment column |
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
| **Task awareness** | First-class — MyTaskCard at top, OtherTasksRow below, clickable rows scroll to fields | Implicit — task counts shown on cells, no per-task UI |
| **Cross-shipment compare** | Hard — page is one shipment | Trivial — columns are side by side |
| **Status transitions** | Hero buttons (Manifest, Promote, Transition) | Not exposed — go to Detail to transition |
| **Comments / threads** | Activity log page (`/shipments/:id/activity`) | Per-cell drawer + filter chips |
| **Right-rail timeline** | Yes (13-step route) | No |
| **Bulk operations** | One field at a time | Excel-like — fill down a row, paste a column |
| **Mobile-friendly** | Yes (right rail collapses, single column) | Limited — narrow viewports lose horizontal context |

### Logical asymmetries to remember

1. **Detail's MyTaskCard is the only place a task auto-starts** when you begin editing its target fields. The Sheet doesn't track "this user is editing this field for this task" — it just saves the field value, and the task auto-resolves server-side when all targets are filled. This is fine in practice, but if a manager is wondering "who started this task?", the answer comes from Detail-page edits or explicit `/start/` API calls. Sheet edits never set `started_at` directly.

2. **Promote to Loading button only exists on Detail.** Drafts can be edited on the Sheet (Shipment Code, blocks, customer, etc.) but the "ready to promote" check (`can_promote_from_draft`) and the button live on the Detail Hero. To advance a draft, you must visit Detail.

3. **The right-rail timeline has no Sheet equivalent.** If you need to see when a shipment hit each status, that's Detail-only.

4. **Comments anchored to a cell** are visible on both surfaces but the editing experience differs:
   - On Sheet: click the indicator → small Drawer scoped to that cell.
   - On Detail: comments appear under the activity log page, organised by shipment-level and field-level. Cell-anchor jumps from notification deeplinks open the Sheet's Drawer, not Detail.

5. **Custom rows (admin-created in Phase 5c)** are Sheet-only. The Detail page's section content is hard-coded against `EDIT_FIELD_GROUPS`; admin-defined custom rows show only on the Sheet.

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
- `Shipment.save()` runs `resolve_for_shipment(self)` — checks every open/in_progress task on this shipment. The `tasks.fill_loading_data` task targets `[cargo_code, block_sources, variety, weight_net, weight_gross]`. If all five are now non-null, mark task DONE.
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
| See who's working on what across one shipment's task graph | **Detail** (OtherTasksRow + MyTaskCard) |
| Triage your own task queue across all shipments | `/me/board` (then click into Detail) |
| See the season at a glance — which phase, which stuck, which late | `/export/shipments/board` (Shipment Kanban) |
| Read the full status timeline for one shipment | **Detail** (right rail) |
| Read or post comments anchored to a specific cell | **Sheet** (Comments Drawer) |
| Read the activity log (status changes + shipment-level comments) | `/shipments/:id/activity` (linked from Detail) |
| Edit admin-defined custom rows | **Sheet** only |
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
