# Garawul (gate guard): truck arrival and exit at the greenhouse — design

**Date:** 2026-09-29
**Status:** approved in chat, not implemented

## Problem

Each greenhouse location (Dusak, Kaka, Owadandepe; more may be added) has a guard at the
gate. Today nobody records when a truck physically enters or leaves the greenhouse. The
loading team does not know a truck has arrived. R21 «Ýyladyşhanadan çykdy» (`departed_at`)
is typed by hand, late or never.

The guard needs a phone screen that shows only the trucks due at his location, with one
tap to mark «Ýyladyşhana geldi» and one tap to mark «Ýyladyşhanadan çykdy».

## Decisions taken

| Question | Answer |
|---|---|
| Role | New role `garawul`, bound to one `LoadingLocation` |
| What arrival does | Save the time and notify all loading deputies and the head. Since 2026-10-01 it no longer fills R19: it opens the loading department's «Ýükleme başlady» task, and R19 moves the status (owner chose this over the original "arrival fills R19") |
| What exit does | Fill R21 `departed_at` (→ Ýola çykdy, gapy → Tamamlandy via auto-advance) |
| One truck, two locations | No. A trip loads at one location |
| «Gelmeli» list | Regular and gapy trucks, dates from today−30 on (7 → 30 on 2026-09-30); no limit ahead since 2026-10-01 (was tomorrow) |
| Truck not in his list | Guard cannot mark it; he calls the loading head |
| Mistakes | Confirm dialog on every tap; guard can undo within 10 min if the status has not moved |
| Tasks | Yes. Marking on the screen closes the task; the task card can also mark |
| Arrival task deadline | None |

## Terms

- **Location of a truck** — `loading_location` when set; otherwise the location of its
  blocks (`block_sources → GreenhouseBlock.location`). No live shipment has
  `loading_location` today, and no open truck mixes locations (checked 2026-09-29:
  Dusak 49, Owadandepe 9, Kaka 8, mixed 0).
- **Guard's location** `L` — `request.user.loading_location`. Never taken from the client for a guard.
  A non-guard role holding the `gate` grant (admin today) picks one via `?location=`.
- **Before departure** — status in `{draft, gumruk_girish, gumruk_chykysh, yuklenme}`.
- **Plate filled** — `truck_plate` is not null and not blank after trimming.
- **Live row** — `is_archived=False`, `deleted_at IS NULL`, status not `cancelled`.

## Part 1 — Backend

### 1.1 Model changes

| Model | Change | Why |
|---|---|---|
| `core.User` | `loading_location` FK → `core.LoadingLocation`, null, `PROTECT` | Binds a guard to one gate. Required when `role == 'garawul'` (serializer validation) |
| `core.User.ROLE_CHOICES` | add `('garawul', 'Gate Guard')` | Choices-only `AlterField`s across core and export, like `quality_inspector` |
| `export.Shipment` | `greenhouse_arrived_at` DateTimeField, null | Gate arrival. Exit reuses `departed_at` |
| `export.Task.kind` | add `GATE = 'gate'` | Code-driven gate tasks |
| `export.Task` | `scope_location` FK → `core.LoadingLocation`, null, `SET_NULL` | Guard sees only his location's tasks |
| `export.Task` | UniqueConstraint `(shipment, step)` where `kind='gate'` | One arrive task and one exit task per truck, even with two guards syncing at once |
| `export.Notification.KIND_CHOICES` | add `('gate_arrival', 'Truck arrived at greenhouse')` | Bell copy |

Migration numbers are picked at write time (parallel sessions — see CLAUDE.md).

### 1.2 The two lists — `services/gate.py`

`location_q(L)` = `Q(loading_location=L) | Q(loading_location__isnull=True, id__in=<ids with a block at L>)`.
The block subquery calls `.order_by()` before being wrapped (MSSQL rule).

- **Gelmeli** `expected(L)` — live row, `location_q(L)`, plate filled, before departure,
  `greenhouse_arrived_at IS NULL`, `departed_at IS NULL`, `date` today−30 or later
  (upper bound today+1 dropped 2026-10-01). Ordered by `date`, then `id`.
- **Ýyladyşhanada** `inside(L)` — live row, `location_q(L)`, `greenhouse_arrived_at` set,
  `departed_at IS NULL`. Does **not** look at status: a status move never hides a truck
  that is physically inside.
- **Recently left** `recently_left(L)` — `location_q(L)`, `departed_at` within the last
  10 min, `greenhouse_arrived_at` set. Shown greyed on the Ýyladyşhanada tab so the exit
  can be undone.

Row payload (nothing else — no customer, firm, price, weight): `id`, `shipment_code`, `truck_plate`,
`truck_plate_2`, `driver_name`, `driver_phone`, `date`, `is_gapy_satys`, `status_code`,
`greenhouse_arrived_at`, `departed_at`, `can_undo`.

### 1.3 Actions

All three run in `transaction.atomic()` with `select_for_update()` on the shipment. The time
is the server `timezone.now()`, captured once as `now`. `updated_by = request.user`, then a
plain `shipment.save()`. That save runs task resolution and `auto_advance_if_ready()`,
so every status change still goes through `transition_to()` (`is_auto=True`, as for any
Sheet edit).

1. **Arrive** — precondition: the shipment is in `expected(L)`; otherwise `409`.
   Writes: `greenhouse_arrived_at = now`, `loading_location = L` if null. Since
   2026-10-01 it does not write `loading_started_at`: closing the arrive task opens
   «Ýükleme başlady» for the loading department, and their R19 moves the status.
   Then one `gate_arrival` notification to every active
   `loading_dept_head` and `loading_dept_head_deputy` user (`bulk_create`, `batch_size=500`),
   message `"{plate} — {location}"`, link `/shipments/{id}`.
2. **Depart** — precondition: the shipment is in `inside(L)`; otherwise `409`.
   Writes: `departed_at = now`. Effect: from `yuklenme`, once the loading data is filled,
   the shipment auto-advances to `yola_chykdy`, or to `tamamlandy` for gapy (existing fork).
3. **Undo** — body `{"event": "arrive" | "depart"}`. Allowed when the mark is at most
   10 min old **and** `status_changed_at` is null or earlier than the mark. Otherwise `409`
   with the reason.
   - Undo depart: clear `departed_at`.
   - Undo arrive (only while `departed_at` is null): clear `greenhouse_arrived_at`.
     `loading_location` stays: it equals the block location the truck was listed under.
   - Any guard of that location may undo, not only the one who marked. `AuditLog` keeps who.

`can_undo` in the payload is computed with the same rule, so the button only shows when the
server will accept it.

### 1.4 Tasks — `sync_gate_tasks(L)`

Gate tasks are code-driven, like `weekly_plan` and `truck_allocation`, and not a
`TaskRule`: a rule is role-wide (every guard would see every location). An
`ALL_FIELDS_FILLED` rule would also hold the document team's auto-advance until the truck
arrives.

| Task | `step` | Opens when | Done when |
|---|---|---|---|
| «TIR {plate} gelmeli» | `gate_arrive` | truck is in `expected(L)` | arrival marked |
| «TIR {plate} çykmaly» | `gate_depart` | truck is in `inside(L)` | exit marked |

Fields: `kind='gate'`, `shipment`, `rule=None`, `assignee_role='garawul'`,
`scope_location=L`, `completion_rule=MANUAL_DONE`, no deadline, `link='/export/gate'`.

`sync_gate_tasks(L)` makes the tasks equal the lists:
- Truck in `expected(L)` → arrive task open (create it, or reopen it after an undo).
- Truck in `inside(L)` → arrive task done, exit task open.
- Truck departed → exit task done.
- Open gate task at `L` whose truck is in neither list (cancelled, deleted, out of the date
  window, packaging moved to another location) → cancelled, reason `rule_mismatch`.

It runs on: every gate list read, `MeTaskListView` for a `garawul` user (same lazy pattern
as the plan tasks), and inside each action for that one shipment. The action closes the
task with `completed_by = request.user`. A close found only by a read-time sync leaves
`completed_by` null.

**Changed 2026-10-01 (owner):** the arrive task must open the moment a truck is assigned,
not when the guard next looks. `sync_shipment_gate_tasks(shipment_id, actor)` now also
runs at the end of every `Shipment.save()` (actor = `updated_by`, like any task a save
resolves — so admin fixing the time on the Sheet is credited) and after Join / Unjoin /
Swap, which bypass `save()`.

`MeTaskListView` shows a guard only gate tasks with `scope_location = his location`.

### 1.5 Endpoint

`/api/v1/export/gate/` — its own `ViewSet`, not `ShipmentViewSet`.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/gate/` | — (`?location=` non-guard roles only) | `{location, expected: [...], inside: [...], recently_left: [...]}` |
| POST | `/gate/{id}/arrive/` | — | row |
| POST | `/gate/{id}/depart/` | — | row |
| POST | `/gate/{id}/undo/` | `{event}` | row |

Permission: new resource `gate` (`can_view` / `can_edit`) in the permission registry.
Seeded: `garawul` view+edit, `admin` and `boss` full (both hold every resource by policy —
`tests_boss_access` enforces it for boss). `director`, `export_manager` and `document_team`
are carved out of their every-resource wildcard, so the gate is off for them (grantable in
the matrix). A `garawul` user with no `loading_location` gets `400`. Errors use the
api-contract shape `{"error": "<code>"}`; the frontend translates `gate.error.<code>`.

Row payload keys (planning fix): `shipment_code` (not `code`) and `status_code` (the
frontend renders `shipment_status.<code>`).

### 1.6 Role touch list (from the `quality_inspector` rollout)

1. `ROLE_CHOICES` + choices-only migrations; confirm no-op with `sqlmigrate`.
2. `seed_permissions.py`: page `export.gate` (new, in `PAGE_REGISTRY`) visible for
   `garawul`, `admin` and `boss`; `me.board` visible for `garawul`; **every other page seeded
   `is_visible=False` for `garawul`**; resource `gate` as above; no `shipment` grants.
   Same rows in a data migration for the live DB.
3. `seed_test_users.py`: one `garawul` test user bound to Dusak.
4. Sheet: new row «Ýyladyşhana geldi» (`greenhouse_arrived_at`, datetime), placed next
   to R21 (row number 49) — shows the time and lets admin and the loading head (+deputy)
   correct it. Caption «Garawul» (`sheet.who.garawul`), but `WHO_TO_ROLE['garawul']` maps to
   the two loading roles, because they, not the guard, edit the cell. In the classic Sheet's
   owner bands the row therefore sits in the loading band. Live DB needs two data
   migrations (field grants + the `SheetRowSetting` row with triggers incl. `boss`). Run
   `TestEveryRoleCanEditItsOwnSheetRow` before and after.
5. `comments.py` `_VALID_ROLES`: not needed (the guard does not comment) — deliberately left out.

## Part 2 — Frontend

### 2.1 Gate page — `/export/gate` (`pageCode="export.gate"`)

Built for a phone at the gate (360 px wide, big type, big buttons).

- Header: location name. Non-guard users with the grant (admin) get a location select.
- One plate search box on top. Matches a substring of `truck_plate` or `truck_plate_2`,
  ignoring case, spaces and dashes, with Cyrillic look-alikes folded to Latin
  (А→A, В→B, Е→E, К→K, М→M, Н→H, О→O, Р→P, С→C, Т→T, Х→X). Filtering is client-side:
  the lists are tens of rows.
- Two tabs with counts: «Gelmeli (N)» and «Ýyladyşhanada (N)».
- Card per truck: plate(s) in large text, driver name + phone (tap to call), date,
  «Gapy» badge, status tag. Overdue trucks (date < today) get a red date.
- Gelmeli card button «Ýyladyşhana geldi»; Ýyladyşhanada card button «Ýyladyşhanadan
  çykdy». Every tap opens a confirm dialog showing the plate.
- Undo: «Yza al» on a card while `can_undo` is true; recently left trucks sit greyed at the
  bottom of Ýyladyşhanada with «Yza al».
- Refetch every 60 s and after each action; `409` shows the server reason as a toast.
- Empty states: no trucks; guard has no location («Size ýer berilmedi — admin bilen
  habarlaşyň»).

### 2.2 Task card

`SelfBoard.tsx` renders `kind === 'gate'` with the same confirm + button as the gate page
(«Ýyladyşhana geldi» for `gate_arrive`, «Ýyladyşhanadan çykdy» for `gate_depart`), calling
the same endpoint. No generic "Done" button on gate tasks, so a task can never close
without the mark. Success invalidates both the task and gate queries.

### 2.3 Role plumbing

- Landing: `DashboardPage` (index route) redirects `garawul` to `/export/gate`.
- Menu: `AppLayout` entry for `export.gate` via `canSeePage`.
- `constants/roles.ts`, `types/index.ts`, `permissions/roleColors.ts`,
  `StaffPageAccessPage.tsx`, `UsersPage.tsx` (both lists) — add `garawul`.
- `UsersPage`: location select, shown and required when role is `garawul`.
- `TaskRulesPage`: list `gate` with the other code-driven kinds.
- i18n `tk` / `ru` / `en`: role «Garawul» / «Охранник» / «Gate guard»; page «Derweze» /
  «КПП» / «Gate»; tabs, buttons, confirm, undo, errors, task titles, notification copy.

## Part 3 — Docs

`docs/obsidian/roles/garawul.md` (new), `docs/obsidian/processes/gate.md` (new),
`permissions-system.md`, the task docs (new kind), `CHANGELOG.md`, `BUILD_TEST_LOG.md`.

## Testing

Backend (`apps.export` + `apps.core`):
- Lists: location from blocks and from `loading_location`; date window today−30 on (no upper bound since 2026-10-01);
  plate required; status set; cancelled / deleted / archived excluded; inside ignores status.
- Scoping: `?location=` ignored for `garawul`, honoured for admin; guard with no location → 400;
  other roles → 403 on `/gate/`; `garawul` → 403 on `/shipments/`.
- Arrive: writes arrival only, never `loading_started_at`; opens «Ýükleme başlady»;
  `draft` stays `draft`; notification to head + all active deputies only; second tap → 409.
- Depart: regular → `yola_chykdy` when loading data is complete, stays `yuklenme` when not;
  gapy → `tamamlandy`.
- Undo: inside 10 min OK; after 10 min → 409; after a status move → 409.
- Tasks: created, closed on mark (credited), reopened on undo, cancelled on drop-out,
  scoped by location, no duplicates under two syncs.
- `TestEveryRoleCanEditItsOwnSheetRow` for the new Sheet row.

Frontend: gate page tabs + counts, plate search folding, confirm before every action, undo
visibility, no-location state; `SelfBoard` gate card calls the endpoint and has no generic
Done button.

## Verify during planning (risks)

1. Clearing `loading_started_at` on undo: does the resolver reopen an already-resolved
   `tasks.trigger_loading_start`? If not, the undo must reopen it too.
2. The field-based task resolver and `is_step_trigger_satisfied()` must ignore
   `kind='gate'` tasks (their `step` is not a status code).
3. Closed season: `transition_to()` raises `SeasonClosedError` during auto-advance — the
   mark must fail cleanly with a message, not a 500.
4. Rows joined later: a truck whose plate is on the export row and whose blocks are still on
   an unjoined supply row has no location and is not listed until the join. By design
   («call the loading head»).
5. Packing parts (planning decision, 2026-09-29): a `draft` with no country and no
   customer is excluded from Gelmeli. Join deletes that row, so a stamp on it would be lost;
   it also matches the owner rule that packing parts carry no tasks. Cost: a truck that
   physically arrives before its destination is set cannot be marked until it is. On the dev
   DB one such row had a plate (`3107001/26`). Reversible if the owner prefers "list it and
   make Join carry the stamp" (needs coordination with the packaging-join work).

## Out of scope

Guard typing plates or creating trucks; vehicles not in the system; auto-marking from the
Traccar geofence; per-location deputies; exit filling `loading_ended_at`.
