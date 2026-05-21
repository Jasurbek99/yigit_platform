---
title: My Work Board (SelfBoard)
tags: [screen, frontend, tasks, kanban, self-board]
related: [[../processes/comments-tasks]], [[../processes/shipment-lifecycle]], [[../processes/permissions-system]]
---

# My Work Board (SelfBoard)

## What Is This Screen?

Route: `/me/board` (navigation label: "My Work" / "Meniň işim" / "Моя работа").

A personal task board showing only the tasks assigned to the current user (or their role). Unlike the main ShipmentList which shows all shipments, this board surfaces *actionable work right now* — grouped into To Do, In Progress, Blocked, and Done Today columns.

The screen uses `useMyTasks()` → `GET /api/v1/export/tasks/?my_tasks=true` and renders tasks as `ITaskListItem` cards (not full `IShipmentDetail`). Clicking a card opens the **SelfBoardTaskDrawer** for inline task completion.

## SelfBoardTaskDrawer — Inline Task Completion

### Purpose

Let users complete tasks entirely inside the drawer without navigating to the full Shipment Detail page. The drawer opens at 480px width with `destroyOnClose`.

### Ownership check — mirrors backend `IsTaskActor`

The drawer uses an explicit ownership check rather than `shipment.my_task?.id === task.id`. The logic mirrors the backend `IsTaskActor` permission (see `apps/export/permissions.py`):

```typescript
const isSupervisor = SUPERVISOR_ROLES.has(user?.role ?? '');

const isOwnOrSupervised =
  user != null &&
  task != null &&
  (task.assignee_user === user.id || task.assignee_role === user.role || isSupervisor);

const isActiveCard = isActiveState && isOwnOrSupervised;
```

Three clauses, matching `IsTaskActor.has_object_permission`:
1. **Assignee user** — the specific user is named on the task.
2. **Assignee role** — the user holds the same role as the task's `assignee_role`.
3. **Supervisor override** — `SUPERVISOR_ROLES` (`export_manager`, `boss`, `admin`, `director`) can act on any task regardless of assignee. Imported from `@/utils/detailSections`.

This fixes the bug where supervisors (whose `get_my_task` returns `null`) and multi-task users always fell through to the dead-end `ReadOnlyTaskSummary`.

### Layout (active / own task)

Three sections, top to bottom:

**1. Task panel** (`SelfBoardActiveTaskPanel.tsx`)
- Shows the role label and task title.
- Progress bar when there are multiple `target_fields_list` entries (mirrors `MyTaskCard` pattern, uses `isFieldFilled` from `TaskCardEditor.helpers`).
- `SelfBoardShipmentFieldList` (fields mode) renders the editable target fields — backed by `SheetCellEditor` for every field type (text, datetime, dropdown, etc.). This replaces `TaskCardEditor`, which is still used on ShipmentDetail but NOT in this drawer.
- `driver_name`, `driver_phone`, `truck_plate`, all lifecycle timestamps (`customs_exit_at`, `loading_started_at`, `departed_at`, `border_crossed_at`, `dest_entry_at`, `customs_entry_at`, `peregruz_date`, `arrived_at`, `sale_started_at`, `sale_ended_at`), and all other sheet-backed fields are now editable via the sheet machinery.
- For `quality.*` dotted-path fields (used by the `quality_inspection` task) that have no matching `IRowConfig`, a `ReadOnlyStubRow` renders: translated label + current boolean value + "edit in shipment detail" hint. No crash.
- `useStartTask` fires on first field click (debounced via `useRef` flag — at most once per mount). Clicks bubble up through the presentation wrapper div.
- "Mark Done" button when `completion_rule === 'manual_done'` and task is open/in_progress.
- `useCompleteTask` fires on mark-done; drawer closes automatically on success.
- Shows a done `<Tag>` when the task is already completed. All fields are read-only when task is done/cancelled (`disabled` prop to renderer).
- Sheet data (`sheetItem`, `rows`, `rowSettings`, `isSheetLoading`) is threaded from `ActiveDrawerLayout`.

**2. Shipment field list** (`SelfBoardShipmentFieldList.tsx`, other-fields mode)
- Compact vertical list of all fields the user can currently edit on this shipment, excluding the task's `target_fields_list` (shown in section 1).
- Data source: `useShipmentSheet()` (`['shipments', 'sheet']` query, staleTime 30s). The full sheet payload is always fetched for this season; the drawer finds its shipment via `.find(s => s.id === task.shipment)`.
- Display values from `getCellValue()` (shared formatter, same as the Sheet grid). Resolves FK names: country → `country_name`, firms → joined codes, not raw IDs.
- Gate: `row_settings[field_key]?.can_current_user_edit === true` (backend-computed per-user permission).
- Skips `input_type === 'readonly'` rows.
- Click a row → sets `useSheetStore.setEditingCell({ shipmentId, rowKey })` → renders `SheetCellEditor` inline.
- `SheetCellEditor` calls `setEditingCell(null)` on save/blur to close itself.
- While sheet is loading, shows a skeleton (not null).
- If the sheet item is not found (older season, different filter) the section is hidden — no crash.

**3. Read-only context** (`OtherShipmentDetails`)
- Collapsed `<Collapse>` panel showing remaining shipment fields as read-only `<Descriptions>` (same as before).

**4. Escape hatch** (`DrawerOpenInFullPageLink`)
- Small de-emphasised "Open shipment detail" button at the bottom — navigates to `/shipments/:id`.

### Unified sheet-backed renderer — `SelfBoardShipmentFieldList`

This component powers both sections (task panel + other fields) with a single implementation:

| Prop | Mode | Behaviour |
|------|------|-----------|
| `fields` | Task-panel | Render exactly these keys in order. No editability/readonly filter. |
| `excludeFields` | Other-fields | Render all user-editable rows except excluded keys + `readonly` rows. |
| `disabled` | Either | Override all rows to read-only (used when task is done/cancelled). |
| `isLoading` | Either | Show skeleton while sheet is fetching. |

Value formatter: `getCellValue(sheetItem, row)` from `src/components/sheet/getCellValue.ts` (extracted from SheetCell, imported by both SheetCell and the drawer).

### Fallback (done / cancelled / not-your-task)

When `isActiveCard` is false (task state is done/cancelled, or the user doesn't own it), `ReadOnlyTaskSummary` renders the cargo code, state tag, deadline, and completed-at timestamp.

### Global state cleanup

`onClose` always calls `setEditingCell(null)` to clear any `SheetCellEditor` state that may be open when the drawer is dismissed.

### After-edit invalidation

Both `useShipmentPatch` and `useShipmentPatchMulti` invalidate `['my-tasks']` in their `onSettled` callback (in addition to `['shipments']`), so completed task cards drop off the board immediately after a field save. `SheetCellEditor` uses `useShipmentPatch`, so the same invalidation fires when editing from the task panel.

## Files

| File | Role |
|------|------|
| `frontend/src/pages/me/SelfBoard.tsx` | Page shell, column layout, task cards, drag-and-drop |
| `frontend/src/components/kanban/SelfBoardTaskDrawer.tsx` | Drawer shell: ownership check, data fetch, layout dispatch; threads sheet data to active panel |
| `frontend/src/components/kanban/SelfBoardActiveTaskPanel.tsx` | Top section: progress + SelfBoardShipmentFieldList (fields mode) + mark-done |
| `frontend/src/components/kanban/SelfBoardShipmentFieldList.tsx` | Unified renderer: task-panel mode (fields) + other-fields mode (excludeFields); uses getCellValue + SheetCellEditor |
| `frontend/src/components/sheet/getCellValue.ts` | Shared display-value formatter (extracted from SheetCell.tsx) |
| `frontend/src/components/sheet/SheetCell.tsx` | Sheet grid cell; imports getCellValue from shared module |
| `frontend/src/hooks/useShipmentPatch.ts` | PATCH mutations (also invalidates `['my-tasks']`) |
| `frontend/src/hooks/useTaskActions.ts` | useStartTask, useCompleteTask |

## i18n Keys (me.board.*)

| Key | EN | TK | RU |
|-----|----|----|-----|
| `drawer_your_task_fields` | Your task | Siziň tabşyrygyňyz | Ваша задача |
| `drawer_shipment_fields` | Shipment fields | Iberişiň meýdanlary | Поля отгрузки |
| `drawer_no_editable_fields` | No editable fields | Redaktirlenip boljak meýdan ýok | Нет доступных для редактирования полей |
| `drawer_more_details` | Other shipment details | Iberişiň beýleki maglumatlary | Прочие детали отгрузки |
| `drawer_open_shipment` | Open shipment detail | Iberim jikme-jigligini aç | Открыть детали отгрузки |
| `drawer_readonly_completed` | Completed {{when}} | {{when}} tamamlandy | Завершено {{when}} |

## i18n Keys (tasks.*)

| Key | EN | TK | RU |
|-----|----|----|-----|
| `tasks.edit_in_detail` | Edit in shipment detail | Iberişiň jikme-jikliginde redaktirle | Редактировать в деталях отгрузки |

## Related

- [[../processes/comments-tasks]] — The underlying task model (`ShipmentComment` with `assignee`).
- [[../processes/shipment-lifecycle]] — The 13 statuses that drive which tasks exist.
- [[../processes/permissions-system]] — `row_settings.can_current_user_edit` gate.
- [[shipment-sheet]] — Source of `rows` + `row_settings` used by the drawer's field list. Also the origin of `getCellValue`.
