# Task Rule Editor (admin-configurable task rules) — Design

**Date:** 2026-09-18
**Status:** Approved in chat, spec pending review
**Module:** `export` (TaskRule engine), small touches in `core` (permission registry) + `frontend`
**Sub-project:** P1 of 3 — P2 manual tasks (F15), P3 scheduled plan tasks, each get their own spec later.

## Goal

An admin can create and edit the shipment task rules that feed "My tasks" from the UI, without a deploy:

1. edit any of the ~22 existing rules (who gets it, deadline, what closes it, on/off),
2. create new rules, in an n8n-style linear **WHEN → IF → THEN** editor,
3. see — before saving — what the change will do to tasks that already exist, then confirm.

Today none of this is possible: rules live only in `seed_task_rules.py` (`TASK_RULES`), there is no
serializer, viewset or admin page for `TaskRule`.

## Decisions (from Q&A, 2026-09-18)

| Question | Decision |
|---|---|
| Scope | All of A–D wanted; split into P1 rule editor (A+B) → P2 manual tasks (C) → P3 scheduled plan tasks (D). This spec is P1 only. |
| Editor style | Linear **WHEN → IF → THEN** card chain (n8n look). No free canvas, no branching. |
| New rule's title | **One typed title, no translation** (`title_text`). The 22 seeded rules keep their i18n `title_key`. |
| Seed command | **Create-if-missing** only. Never overwrites an existing rule. `--reset` requires `--force`. |
| Open tasks on rule save | **Auto re-sync** + **retro-apply conditions**, behind a **preview → confirm** step. |
| Who can edit | New permission-matrix page `admin.task_rules`, seeded **admin only**. |
| Conditions | **Multiple, AND-ed**, each `field = value`. |
| Delete | **No delete** — deactivate only. |
| Audit | Every rule save writes an `AuditLog` row. |

## Behaviour rules

1. **Rule matches** a shipment when the shipment enters `rule.step` and **every** condition matches
   (`str(getattr(shipment, field)) == value`, same coercion contract as today). Zero conditions = always matches.
2. **Step is locked** once the rule has generated any Task. To "move" a rule, deactivate it and create a new one.
3. **No delete.** `Task.rule` is `PROTECT`, and a deleted seeded rule would be re-created by the seed anyway.
4. **Title shown** on every task surface = `title_text` if non-empty, else `t(title_key)`. A rule must have one of the two.
5. **Applying a rule save** (same code path for create, edit, activate, deactivate) — closed-season shipments are never touched:
   1. **Re-sync** every OPEN / IN_PROGRESS / BLOCKED task of this rule: `title_key`, `title_text`, `target_fields`,
      `completion_rule`, `target_value`, `assignee_role`, and `deadline` recomputed as
      `parse_deadline_rule(rule.deadline_rule, reference=task.created_at)` (tasks are created at status entry).
   2. **Retro-cancel**: open tasks of this rule whose shipment no longer matches the conditions → `CANCELLED`.
      A deactivated rule matches nothing, so all its open tasks are cancelled.
   3. **Retro-create** — only when the save creates the rule, changes its conditions, or activates it: shipments
      whose **current** status is `rule.step`, that match, and have no task for this rule → task created via
      `generate_tasks_for_status(shipment, step, rules=[rule])`. If a `CANCELLED` task for (shipment, rule) exists,
      it is **reopened** (state → OPEN) instead — the engine's idempotency skips any existing (shipment, rule)
      pair, so a new row would never be created.
   4. `resolve_for_shipment()` on each affected shipment, so re-synced/created tasks that are already satisfied close.
6. **Auto-advance risk (surfaced in preview, not prevented).** `is_step_trigger_satisfied`
   (`services/shipment.py:373`) treats CANCELLED as finished. Cancelling the last open auto-task at a shipment's
   current step makes that shipment eligible to **auto-advance on its next edit**. The save itself never calls
   `auto_advance_if_ready` / `transition_to`. The preview lists these shipment codes.
7. **Preview vs apply race**: preview is advisory. Apply recomputes inside one transaction; the result toast shows
   the actual counts.
8. **"Changed conditions / activated" is decided server-side.** `apply_rule_change` loads the DB row before saving
   and compares the incoming condition set (as `{(field, value)}`) and `is_active` with it. Retro-create (5.3)
   runs only if the rule is new, the set differs, or `is_active` went False → True.
9. **Auto-advance eligibility respects conditions.** `is_step_trigger_satisfied` today counts every active
   non-manual rule on the step, ignoring conditions. It changes to count only rules whose conditions match
   **this** shipment. Otherwise one admin-added conditioned auto rule on a manual-only step would make that step
   auto-advance-eligible for every shipment. No change for the 22 seeded rules: every seeded step has an
   unconditioned auto rule or a complementary True/False pair (`is_gapy_satys`, `has_peregruz`), so at least one
   auto rule always matches — pinned by a test.
10. **Scan bounds.** Preview and apply only look at shipments in open seasons (`season.closed_at IS NULL`).
    Preview returns counts plus at most 50 `may_advance` shipment codes (`may_advance_total` carries the full count).

## Data model

### Changed: `export.TaskRule`

| Field | Change |
|---|---|
| `title_text` | **New.** `CharField(max_length=128, blank=True, default='', db_collation='Cyrillic_General_CI_AS')` |
| `title_key` | Now `blank=True, default=''` (admin-created rules have none). |
| `seed_key` | **New.** `CharField(max_length=64, blank=True, default='', db_index=True)`. Stable identity for seeded rules; `''` for admin-created. Not unique at DB level (MSSQL treats NULL/'' collisions badly; uniqueness enforced by the seed). |
| `condition_field`, `condition_value` | **Removed** (moved to `TaskRuleCondition`). |
| `updated_at` | **New.** `DateTimeField(auto_now=True)`. |

### New: `export.TaskRuleCondition`

```
rule   FK TaskRule, on_delete=CASCADE, related_name='conditions'
field  CharField(max_length=64)
value  CharField(max_length=64, db_collation='Cyrillic_General_CI_AS')
Meta: db_table='export_task_rule_condition'
```

No JSON column (MSSQL rule). Must be re-exported from `apps/export/models/__init__.py`.

### Changed: `export.Task`

| Field | Change |
|---|---|
| `title_text` | **New**, snapshot of the rule's `title_text` (same definition as on TaskRule). |
| `title_key` | Now `blank=True, default=''`. |

### Migrations (next free numbers in `export`)

1. Schema: add `TaskRuleCondition`, `title_text` ×2, `seed_key`, `updated_at`; relax `title_key`.
2. Data (the risky one — runs while the old columns still exist):
   - for each rule with non-blank `condition_field`, create one `TaskRuleCondition(field, value)` from the old columns;
   - fill `seed_key` by matching the old upsert key `(step, title_key, condition_field, condition_value)` against a
     **frozen copy of the 22 keys inlined in the migration** (never import `TASK_RULES` from the command module —
     it will keep changing);
   - a row that matches no key (e.g. hand-edited on prod) keeps `seed_key=''` and is treated as admin-owned;
   - reverse migration: copy the single condition back (rules with >1 condition cannot exist yet at this point).
3. Schema: drop `condition_field`, `condition_value`.

`title_text` has the identical definition (length, collation) on `TaskRule` and `Task`, so the snapshot copy and
the reconcile comparison never mix collations.

## Service layer — `export/services/task_rule_admin.py` (new)

Keeps views thin; reuses `task_rules.py`.

- `plan_rule_change(rule, proposed) -> RuleChangePlan` — pure read: counts + ids for resync / cancel / create /
  reopen, and `may_advance` shipment codes (rule 6). Used by preview and by apply.
- `apply_rule_change(rule_or_none, data, user) -> RuleChangeResult` — `transaction.atomic`: save rule + conditions,
  run behaviour rule 5, write `AuditLog`, return actual counts.
- `_conditions_match(rule, shipment)` in `task_rules.py` replaces `_condition_matches`: `all(...)` over
  `rule.conditions.all()`. Callers that load many rules add `prefetch_related('conditions')`
  (`generate_tasks_for_status`, `backfill_tasks`, `is_step_trigger_satisfied` if it needs it).
- `reconcile_open_tasks_with_rules()` gains `title_text` and `deadline` axes and an optional `rule=` scope, so the
  existing `reconcile_tasks` command and the new apply path share one implementation.
- Field validation helper `shipment_field_resolves(name)` extracted from `checks.py` into the service module; the
  system check and the serializer both call it.

## API

All under the export router, `TaskRuleViewSet` (list, retrieve, create, update/partial_update; **no destroy**).
Permission: page grant `admin.task_rules`.

### `GET /api/v1/export/task-rules/`

List with nested `conditions`, `open_task_count`, `has_tasks` (drives the step lock). Ordered by lifecycle step order, then id.

### `POST /api/v1/export/task-rules/` · `PATCH /api/v1/export/task-rules/{id}/`

Body = rule fields + `conditions: [{field, value}]` (replace-all). Applies via `apply_rule_change`. Response =
rule + `result: {resynced, cancelled, created, reopened, may_advance: [shipment_code]}`.

### `POST /api/v1/export/task-rules/preview/`

Body = same as create/update plus optional `id`. Writes nothing. Returns the `result` shape above, with
`may_advance` capped at 50 and `may_advance_total` added.

### `GET /api/v1/export/task-rules/options/`

Dropdown data: `steps` (ShipmentStatusType codes + names, lifecycle order), `roles`, `completion_rules`,
`fields` (from `SheetRowSetting` rows whose `field_key` passes `shipment_field_resolves`, with their labels).

### Validation (serializer, 400 with field errors)

- `step` is a real `ShipmentStatusType` code; unchanged if `has_tasks`.
- every `target_fields` entry and every condition `field` passes `shipment_field_resolves`.
- `assignee_role` is a known role.
- `field_equals` → exactly one target field and non-empty `target_value`.
- `deadline_rule` is empty/`none` or `parse_deadline_rule` returns non-None.
- `title_text` or `title_key` non-empty.

## Permissions

- Add `('admin.task_rules', 'Admin: Task Rules')` to `core/permission_registry.py` `PAGE_REGISTRY`.
- `seed_permissions` grants it to admin only.
- Frontend nav entry and route gated by the same page code.

## Seed command

- `seed_task_rules`: each `TASK_RULES` entry gets a `seed_key`; lookup by `seed_key`; **create if missing, never
  update**. Conditions in `TASK_RULES` become a list and are written as `TaskRuleCondition` rows on create.
- `--reset` refuses unless `--force` is also passed.
- Still runs `reconcile_open_tasks_with_rules()` afterwards (harmless when nothing changed).

## Frontend

- **Route** `/admin/task-rules`, `pages/admin/task-rules/TaskRulesPage.tsx`: rules grouped by step (lifecycle
  order); each row: title, role, open-task count, Active switch. Switch goes through preview → confirm.
- **Editor drawer** `TaskRuleEditor.tsx`: three antd cards joined by arrows:
  - **WHEN** — step select (disabled when `has_tasks`, with a hint).
  - **IF (all)** — condition rows `[field ▼] = [value]  ✕`, "+ add condition".
  - **THEN create task** — title input (or read-only i18n title for seeded rules, with an override input), role
    select, completion type + target fields (+ value for `field_equals`), deadline picker.
- **Deadline picker** — type select (none / same day at HH:MM / next business day at HH:MM / N hours after status /
  Friday end of week) + input; serialises to and parses from the existing grammar string.
- **Save flow** — Save → `preview` → modal ("cancel 3 · create 5 · re-sync 12 · may auto-advance: …") → Confirm →
  PATCH/POST → toast with actual counts.
- **Title fallback** — one helper `taskTitle(task, t)` = `task.title_text || t(task.title_key)`, used at every
  current `t(task.title_key)` call site (`BoardTasksModal`, `SelfBoardActiveTaskPanel`, `SelfBoardTaskDrawer`,
  `SelfKanbanCard`, `PlanTaskCard`, `MyTaskCard`, `OtherTasksRow`, `ShipmentCompletenessBar`, `ShipmentGuidanceLine`).
  Backend adds `title_text` to the task serializer (`serializers.py:2278` area), `/me/tasks/`, `shipment.my_task`
  and `services/completeness.py` payloads.
- **Hooks** (TanStack Query): `useTaskRules`, `useTaskRuleOptions`, `usePreviewTaskRule`, `useSaveTaskRule`.
- **Types** in `types/index.ts`: `TaskRule`, `TaskRuleCondition`, `TaskRuleChangeResult`; `title_text` on `Task`.
- **i18n** — editor labels in `en/ru/tk.json`.

## Known consequences

- The DB, not `TASK_RULES`, is now the source of truth for rules. Changing a default in code no longer reaches
  existing databases; it must be done in the editor (record in `DECISIONS.md`).
- Rule 6: a rule edit can make shipments auto-advance on their next edit. Mitigated by preview, not blocked.
- Admin-typed titles are single-language by decision; TK/RU users may see mixed languages.
- There is no marker for *why* a task was cancelled. A task an admin cancelled by hand is reopened if its rule's
  conditions change (or the rule is re-activated) while the shipment still sits at that step and matches.
  Title/role/deadline-only edits never reopen anything.

## Testing (TDD, write failing tests first)

**Backend** (`apps/export/tests/`):
- AND matching: 0, 1, 2 conditions; one mismatching condition blocks creation.
- Data migration: a rule with `condition_field` ends with one equivalent `TaskRuleCondition`; `seed_key` filled.
- Serializer validation: each rule in the Validation list rejects with a field error.
- Preview writes nothing and returns correct counts.
- Apply: re-sync (incl. deadline recompute from `created_at`), retro-cancel, retro-create, reopen-cancelled,
  deactivate cancels all open, closed season untouched, `may_advance` lists the right shipment.
- Step change rejected when `has_tasks`.
- Permission: admin allowed; a role without `admin.task_rules` gets 403.
- Seed: admin edit survives a second `seed_task_rules` run; missing seeded rule is re-created; `--reset` without
  `--force` refuses.
- System check `check_task_rule_fields` still passes and now reads conditions from the child table.
- Retro-create/reopen does **not** run on a title/role/deadline-only edit.
- `is_step_trigger_satisfied`: a non-matching conditioned auto rule alone does not make a step eligible; for every
  seeded step the result is unchanged for a gapy and a non-gapy / peregruz and non-peregruz shipment.
- Preview caps `may_advance` at 50 codes and ignores closed-season shipments.
- Scope note: no Sheet permission change, so `TestEveryRoleCanEditItsOwnSheetRow` is not part of this gate.

**Frontend**:
- Deadline picker round-trip for every grammar form.
- Editor: add/remove condition, step disabled when `has_tasks`, preview modal shows counts before PATCH.
- `taskTitle` fallback: `title_text` wins, else translated key.

## Docs to update

- `docs/obsidian/reference/task-rules.md` — editor, conditions table, seed behaviour.
- `docs/obsidian/processes/comments-tasks.md` — engine section (conditions, retro-apply); fix stale "13 rules".
- New `docs/obsidian/screens/admin-task-rules.md`.
- `CHANGELOG.md`, `BUILD_TEST_LOG.md`, `DECISIONS.md` (DB is source of truth for task rules).

## Out of scope (YAGNI)

- Manual task create/assign/cancel UI (P2, F15).
- Schedule triggers and the hardcoded plan-task generators (P3). Separate finding: `run_weekly_plan_setup` and
  `generate_local_sell_plan_tasks` depend on OS cron, and the beta crontab is empty.
- OR logic, operators other than `=`, multiple actions per rule, free-form canvas, rule versioning/history UI.
- Custom Sheet fields (`ShipmentCustomFieldValue`) as condition/target fields.
