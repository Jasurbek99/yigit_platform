# Task Rule Assignees + "Colleagues' tasks" — Design

Date: 2026-10-05
Status: approved in chat, awaiting spec review

## Problem

Shipment tasks are owned by a **role** (`Task.assignee_role`). Every user of that role
sees every task of the role. The owner wants an admin to name **one or more specific
users** of the role per task type, and — when one of them is absent — let the other
users of the role still see and do that work.

## Decisions (from the brainstorming Q&A)

| # | Question | Answer |
|---|----------|--------|
| 1 | Granularity of assignment | **Per TaskRule** (task type). Empty list = whole role, as today. |
| 2 | Absence / substitution | **No admin action.** Every role user has a "Colleagues' tasks" tab showing the role's tasks assigned to others, and can act on them. |
| 3 | Which tasks | **TaskRule-generated (shipment) tasks only.** Code-generated kinds (weekly_plan, daily plan, truck_allocation, plan_ack, local_sell) stay unchanged. |

## Design

### 1. Model — `export.TaskRuleAssignee`

New table in `backend/apps/export/models/task.py` (re-exported from `models/__init__.py`):

- `rule` — FK `TaskRule`, `on_delete=CASCADE`, `related_name='assignees'`
- `user` — FK `core.User`, `on_delete=CASCADE`
- `created_at` — auto
- `unique_together = ('rule', 'user')`

No JSON/Array fields (MSSQL). Migration number: next free in `export/migrations`
(currently `0094`) — re-check before writing, parallel sessions.

**Live lookup, not snapshot.** `Task.rule` already exists, so visibility reads the rule's
assignee list at query time. Changing assignees immediately re-routes already-open tasks;
no reconcile step. `Task.assignee_user` is **not** used for this (it stays the
personal-assignment field for weekly_plan tasks).

### 2. "My tasks" — `MeTaskListView` (`backend/apps/core/views_me.py`)

Regular (non-supervisor) branch, after the existing role + `assignee_user` filter, add:

```
task.rule IS NULL                         -- code-generated kinds, unchanged
OR task.rule has no assignees             -- whole role, as today
OR request.user IN task.rule.assignees
```

Implemented with `Exists(TaskRuleAssignee ...)` subqueries (no `.distinct()` on a join).
Only **valid** assignees count (active, role still in the rule's role group). If every
named user was deactivated or changed role, the rule falls back to "whole role".
Garawul gate filter keeps applying on top.

Supervisors (`boss`, `admin`, `director`, export_manager-like): **unchanged** — they see
everything.

KPI tiles (`MeKpiTodayView`) stay **role-level, unchanged**: they count the role's tasks
done today. Narrowing them by assignee would drop tasks a colleague closed on someone's
behalf from "Done today".

### 3. "Colleagues' tasks" — `?scope=colleagues` on the same endpoint

For regular users only (supervisors: param ignored, they already see all):

```
assignee_role IN task_roles_for(my role)
AND task.rule has assignees
AND request.user NOT IN task.rule.assignees
```

Same season / state / step / overdue filters and same garawul gate filter apply.

**Acting on them:** no permission change needed. `IsTaskActor` already allows any user
whose role matches `task.assignee_role` (via `task_roles_for`). `completed_by` records
who actually did it.

### 4. Admin — editing assignees

- `TaskRuleSerializer` gains read field `assignees: [{id, full_name}]`.
- New action `PUT /api/v1/export/task-rules/{id}/assignees/` with body `{"user_ids": [..]}`
  replaces the list (delete + create one-by-one; at most a handful of rows).
- Validation: every user must be active and have `role in task_roles_for(rule.assignee_role)`
  → else 400 naming the bad ids.
- Write permission: **superuser, `admin`, `director`** (same set as task cancel,
  `_CANCEL_ROLES`). *Assumption — confirm if another role (e.g. boss) should edit.*
- Each change writes an `AuditLog` entry (rule id, old ids → new ids).
- Helper endpoint for the picker: reuse an existing user list filtered by role if one
  exists; otherwise `GET /api/v1/export/task-rules/{id}/assignee-candidates/`.

### 5. Frontend

- `TaskRulesPage.tsx`: new "Исполнители" column. Shows names (or "Вся роль" when empty).
  Users with edit rights get a multi-select limited to candidates of the rule's role.
- My tasks page: new tab "Задачи коллег" next to "Мои задачи", shown only to
  non-supervisors; uses `?scope=colleagues`. Same card/actions as My tasks.
- i18n keys in `ru.json`, `en.json`, `tk.json`.

### 6. Docs

Update `docs/obsidian/reference/task-rules.md`, `docs/obsidian/screens/task-rules.md`,
`docs/obsidian/reference/task.md`; `CHANGELOG.md`; `BUILD_TEST_LOG.md`.

## Testing

Backend (`apps.export` / `apps.core`):
1. Rule with assignees → task visible in My tasks only to those users.
2. Rule without assignees → task visible to the whole role (regression).
3. Code-generated task (`rule IS NULL`) → unchanged behaviour.
4. `?scope=colleagues` → shows role tasks assigned to others, never my own, never other roles.
5. A colleague can `start` / `complete` a task assigned to someone else; `completed_by` = colleague.
6. PUT assignees rejects a user of another role (400) and a non-admin caller (403).
7. Deputy equivalence: `loading_dept_head_deputy` can be assigned to a `loading_dept_head` rule.
8. Supervisor list unchanged.

Frontend: TaskRulesPage assignee column render + save; colleagues tab fetches with `scope=colleagues`.

## Out of scope

- Absence dates, vacation calendar, named substitutes.
- Assignees for code-generated task kinds.
- Notifications to specific assignees (no per-role task notification exists today).
