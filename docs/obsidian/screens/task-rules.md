---
title: Task Rules Page
tags: [screen, tasks, reference]
---

# Task Rules — `/export/task-rules`

A read-only reference screen that answers the question operators ask every week:
**"why did I get this task, and what makes it go away?"**

It renders the live `export_task_rule` rows, so it cannot drift from the engine
the way a hand-maintained list would. The full explanation of the system behind
it is [[../reference/task]]; the per-step narrative catalog is
[[../reference/task-rules]].

Component: `frontend/src/pages/export/TaskRulesPage.tsx`
Hook: `frontend/src/hooks/useTaskRules.ts`

## What is on the page

1. **How a task appears** — a four-line explainer: the trigger is always a status
   change; auto rules watch fields; Mark Done rules cover physical actions; Mark
   Done tasks never hold a truck back.
2. **Rule catalog** — one row per `TaskRule`, in lifecycle order:

   | Column | Source |
   |---|---|
   | Opens when shipment enters | the translated status name + the raw `step` code underneath |
   | Task | `t(title_key)` — the same label My Tasks shows |
   | Responsible role | `assignee_role_display` |
   | Completes by | Auto vs **Mark Done**, plus one tag per watched field (`= value` for `field_equals`) |
   | Only when | the rule's `condition_field = condition_value`, else "Always" |
   | Deadline | `deadline_rule` rendered in words (see below) |

   Filters: by role, and a **Show inactive** toggle. Inactive rules are hidden by
   default and tagged when shown — a deactivated rule is exactly what someone
   debugging "my task never appeared" is looking for.
3. **Tasks that do not come from a shipment** — a second table for the three
   code-driven kinds, in the same shape (task / role / created by / completes
   by). This is **not an appendix**: the rule catalog above covers only
   `sales_rep`, `document_team`, `transport`, `loading_dept_head`,
   `export_manager` and `quality_inspector`. A `greenhouse_manager` has **no rule
   at all** — their entire queue (71 live tasks as of 2026-09-22) is the
   weekly-plan kind, so without this table the page would read as "you have no
   tasks" to that role. Two footnotes: these three are code, not rules, so
   neither this page nor the admin matrix can change them; and a task can be open
   for a role with no rule here, because rules fire only on the transition into a
   step and a task keeps the role it was given when it was created.

### Everything on the page is translated

The API returns identifiers; the page resolves them against the bundles rather
than printing them:

- **Step name** — `t('shipment_status.<step>')`, falling back to the server's
  `step_display`. The serializer sends `name_en or name_tk`, so rendering
  `step_display` directly would show English to every locale. All 13 rule steps
  are keyed in tk/ru/en.
- **Watched + condition fields** — `fieldLabel()` tries `tasks.field_label.<key>`
  (the namespace `SelfBoardShipmentFieldList` uses, and the only place the dotted
  `quality.*` paths are named), then `shipment_edit_drawer.field.<key>`, then the
  raw key. The second step matters: `tasks.field_label` holds 7 keys, while the
  rules watch 31 — without it, 26 of them would render as snake_case.
  `has_peregruz` is the one gate the edit drawer does not label (it is derived,
  not editable), so it was added to `tasks.field_label`.
- **Condition value** — `True` / `False` arrive as Python reprs (the engine
  compares `str(getattr(shipment, field))`), and render as Yes / No.

The deadline grammar (`24h_after_status`, `13:00_same_day`,
`HH:MM_next_business_day`, `friday_eow`) is rendered in words by
`formatDeadline()`, which mirrors `parse_deadline_rule()` in
`backend/apps/export/services/task_rules.py`. An unrecognised rule falls through
to the raw string rather than being hidden — seeing the odd value is the point of
a reference page.

## Access

Page code **`export.task_rules`**, seeded visible for `admin`, `director`,
`export_manager`, `document_team`, `boss`, `greenhouse_manager` and `seller`
(core migration `0056_task_rules_page_perms`). The first five explain tasks to
*other* people; the last two are there for the opposite reason — they own no
`TaskRule` at all, so the code-driven-kinds table is the only written description
of their own queue. Every other role gets an explicit `is_visible=False` row, so
an admin can grant it from `/admin/permissions` without a deploy.

The migration's `VISIBLE_ROLES` and `seed_permissions`' `PAGE_DEFAULTS` are two
independent lists — one heals an existing database, the other builds a fresh one
— and `test_migration_visible_set_matches_the_seeded_matrix` pins them together.
`core/0054` shipped with exactly that gap.

The gate is enforced in three places that must stay in step:

- nav + route: `canSeePage` / `ProtectedRoute pageCode="export.task_rules"`
- endpoint: `CanViewTaskRules` in `backend/apps/export/permissions.py`, reading the
  same page row

## API

`GET /api/v1/export/task-rules/` — a **flat array, not paginated**, sorted by the
status table's `step_order` (rules on a retired status code sort last, with a null
`step_order`). Optional `?is_active=true|false`; by default both active and
inactive rules are returned. Not season-scoped — rules are global configuration.

`target_fields` arrives as a **list**. It is stored as a CSV `CharField` (MSSQL:
no JSONField) and split by the serializer, so the frontend must never re-parse it.

```json
{
  "id": 1,
  "step": "draft",
  "step_display": "Draft",
  "step_order": 0,
  "step_phase": "DRAFT",
  "title_key": "tasks.set_destination",
  "assignee_role": "export_manager",
  "assignee_role_display": "Export Manager",
  "target_fields": ["country", "customer", "import_firm"],
  "completion_rule": "all_fields_filled",
  "completion_rule_display": "All target fields filled",
  "target_value": "",
  "deadline_rule": "24h_after_status",
  "condition_field": "",
  "condition_value": "",
  "is_active": true
}
```

## Not built yet

Editing rules from this page. A `TaskRule` edit leaves every existing open task on
its snapshotted `target_fields` until `reconcile_tasks` runs, so write support
needs that reconciliation wired into the save path first — otherwise one edit
silently strands the open tasks. Creating and cancelling ad-hoc tasks is a
separate gap (F15 in `docs/FINDINGS_BACKLOG.md`).

## Tests

- `backend/apps/export/tests_task_rules_api.py` — page gate (grant / hidden /
  missing row / superuser), flat-array shape, lifecycle ordering, CSV→list,
  `?is_active=`, retired-status fallback, the migration's seeding helper, and the
  migration-vs-seed_permissions drift guard
- `frontend/src/pages/export/TaskRulesPage.test.tsx` — the explainer text, row
  rendering, auto vs Mark Done, deadline wording, condition vs "Always", the
  inactive toggle, the error state, and the three translation paths (status code,
  edit-drawer field labels, `True` → Yes)
