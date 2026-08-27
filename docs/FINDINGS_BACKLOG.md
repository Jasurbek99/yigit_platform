# Findings Backlog — 2026-08-22

Everything found during the role/access/lifecycle audit, in one place. **Nothing here is
fixed** — recorded for later by instruction.

How it was found: a read-only GET sweep of 15 roles × 109 API endpoints against the live
backend, three reviewer passes over the source, and a new 31-test lifecycle suite on the
throwaway test DB. No production data was written apart from 11 `t_*` test accounts.

Detail lives in [ROLE_ACCESS_AUDIT.md](ROLE_ACCESS_AUDIT.md) and
[ROLE_PROCESS_TEST_PLAN.md](ROLE_PROCESS_TEST_PLAN.md). This file is the index.

---

## Fix order

| # | Sev | What | Where |
|---|-----|------|-------|
| F1 | **CRITICAL** | Any authenticated user can overwrite any block's harvest forecast | `greenhouse/views_daily_board.py:71` |
| F12 | **HIGH** | The lifecycle transition button is unreachable for every role that owns a step | `export/views.py:143-171` |
| F9 | **HIGH** | Customs-expense ledger (full cash float) readable by all 15 roles | `export/views_finance.py:369` |
| F2 | **HIGH** | `domestic-sales` serves `price_per_kg` to all 15 roles | `greenhouse/views.py:513` |
| F6 | HIGH | `greenhouse_manager` sees the Shipments nav link; all 7 endpoints behind it 403 | `seed_permissions.py:269` |
| F13 | LOW | The repo contradicts itself on `warehouse_chief.can_create`, and `seed_permissions` cannot heal drift | `seed_permissions.py:218` vs `reference/api-endpoint-map.md:88` |
| F10 | MED | `clients-report` relies on the frontend route guard for access control | `export/views_clients_report.py:5` |
| F3 | MED | `greenhouse/admin/blocks/` + `admin/block-assignments/` readable by all 15 | `greenhouse/views_admin.py:113,138` |
| F7 | MED | `export_manager` + `document_team` have a dead Boss Analytics link | `core/permissions.py:400` |
| F4 | MED | `harvest-plans/` + `day-entries/` reads ungated | `greenhouse/views.py:58,431` |
| F8 | LOW | `boss` has a dead Sales-Rep Coverage link | `export/views.py:4057` |
| F11 | LOW | Six page grants with no matching resource grant (config drift) | `seed_permissions.py` |
| F14 | LOW | `tests_cancel` is order-dependent; 10+ failures when run alone | `export/tests_cancel.py` |
| F5 | LOW | Transport module open to all — already tracked as an interim choice | `transport/views.py` |
| P5 | **needs owner call** | The real loading department (`loading_dept_head` + 5 deputies) owns **no** lifecycle edge; the two loading edges belong to `warehouse_chief`, which has one test account | `services/shipment.py:68,74` |
| P1 | — | `yola_chykdy` owned by `document_team` in code, `transport` in the DB | `services/shipment.py:75` |
| P2 | — | `ShipmentStatusType.step_order` contradicts the real graph | live DB |
| P3 | — | `ShipmentStatusType.required_role` is dead data, read by nothing | live DB |
| P4 | — | Two different role sets share the name `PRIVILEGED_ROLES` | `core/roles.py:84` vs `services/shipment.py:44` |
| F15 | MED | Admin panel has no way to create ad-hoc Tasks or delete/cancel existing ones | `export/views.py:3746` |
| T1 | — | `document_team` account carries role `export_manager` | live DB |
| T2 | — | `export_manager`/`em123` and `document_team`/`dt123` passwords do not work | live DB |
| ~~S1~~ | — | **CLOSED 2026-08-23.** The `QuotaIssuance` half closed via `fix_quota_issuance_seasons`; the one mismatched issuance had already been deleted by the owner. The remaining 6 `WeeklyTruckAllocation` rows (W35/2026) were **deleted** by owner instruction, with their 18 splits | live DB |
| S2 | **needs owner call** | **July 2026 still belongs to no season.** Truck-allocation rows there deleted 2026-08-23; **4 ACTIVE contracts remain stranded** — deleting them is blocked by `PROTECT`ed sales tied to shipments 663/664 | live DB |

---

## S1 / S2 — season FKs that disagree with their own dates (added 2026-08-23)

Found while fixing the seller panel: a sell-plan grid on the active season was empty because
every W34/2026 row still pointed at `2025-2026`. The season FK on these tables is a **second,
unenforced copy** of a fact the row's own date already determines, so it drifts whenever a row
is written before a newer season opens — and the season-scoped list then hides the row.
`backfill_season_fks` cannot repair any of it: it only fills `season IS NULL` and never
re-points a row that already points somewhere.

### S1 — CLOSED 2026-08-23

`WeeklyLocalSellPlan`: 25 rows (W34/2026) **re-stamped** `2025-2026 → 2026-2027` via
`fix_local_sell_plan_seasons`.

`WeeklyTruckAllocation`: 6 rows (W35/2026) **deleted** on owner instruction rather than
re-stamped, together with their 18 `TruckDestinationSplit` children.

`QuotaIssuance`: **no mismatch exists.** An earlier count of 1 in this file was wrong — a
re-audit of the live DB the same day found zero. Corrected rather than left standing.

### S2 — July 2026 still has no season, and 4 active contracts are stranded in it

`2025-2026` ends `2026-06-30`; `2026-2027` starts `2026-08-01`. **Nothing covers July 2026**,
so `_season_for()` returns `None` there and no date-matching backfill can ever assign those
rows. Owner instruction was to delete them; that was carried out as far as the schema allows:

| Row | Outcome |
|-----|---------|
| 3 `WeeklyTruckAllocation` (W29/2026) + 12 splits | **deleted** |
| 6 `WeeklyTruckAllocation` (W1/2025, Mon 2024-12-30 — a *second* gap, before the first season) + 15 splits | **deleted** (627,540 kg of planned tonnage) |
| `Contract#66` `2/26-HG-EXP` (no sales attached) | **deleted** |
| `Contract#62,63,64,65` | **NOT deleted — `PROTECT`ed** |

The four survivors each carry one `ContractSale` tied to a real shipment
(`#62`→sale 18/shipment 663, `#63`→19/663, `#64`→20/664, `#65`→21/664; 8,000–10,000 kg each).
`ContractSale.contract` is `on_delete=PROTECT`, so deleting the contract fails at the DB layer
unless the sale is deleted first — which would also detach the invoice and quota line from
shipments 663/664. **That is a materially bigger deletion than the one authorised and was not
performed.** The two ways out are (a) delete those 4 sales too, or (b) move a season's date
range so July 2026 is covered and the contracts become visible again.

Every row deleted on 2026-08-23 was serialised first to
`backups/2026-08-23_season_gap_rows.json` (Django `loaddata` format; `backups/` is gitignored —
it is production data). Restoring is `manage.py loaddata` on that file.

> The structural fix behind all of this — deriving the season from the row's own date at read
> time instead of storing a FK that can disagree — is out of scope and not proposed here. It
> would touch every season-scoped queryset.

## Corrected 2026-08-22 — F13 was wrong when first written

I first recorded F13 as *"`warehouse_chief` lost the `can_create` its `export.drafts` grant
exists for"*, and marked it HIGH after seeing both create buttons missing in the browser.
**That framing was wrong.** The documentation says `can_create = False` is the *intended*
state for this role:

- `roles/support-roles.md`: *"Warehouse Chief — **cannot create shipments** or access admin."*
- `reference/api-endpoint-map.md:88`: POST maps to `shipment.can_create` — *"**False** for
  `weight_master` and `warehouse_chief` even though they OWN the manifest"* — which is exactly
  why the pallet-write paths carry a hand-written exemption.
- `processes/draft-shipments.md:129` and `processes/shipment-lifecycle.md:199`: the supply
  draft is created by **Soltanmyrat, role `loading_dept_head`** — not `warehouse_chief`.

So the live DB is right and the browser result was correct behaviour, not a defect.

What remains is smaller and real:

1. `seed_permissions.py:218` sets `warehouse_chief → shipment: _VCE` with the comment
   *"warehouse_chief can now create draft shipments (Finding #2)"*, which **contradicts**
   `api-endpoint-map.md:88`. One of the two is out of date; the repo does not say which.
2. `seed_permissions` only `get_or_create`s and **never overwrites**
   (`processes/permissions-system.md:327` documents this and lists two other live drifts from
   the same cause), so that seed change could never have taken effect on an existing DB
   anyway.
3. `document_team` carries `can_delete = 1` live where the seed says `_VE`. Nothing in the
   repo asks for it.

**In practice `warehouse_chief` is close to a legacy role**: the live DB has exactly one
account on it (`warehouse_chief` / Anwar Test, a test account), while the real loading
department is 1 × `loading_dept_head` (Soltanmyrat) + 5 × `loading_dept_head_deputy`.
`weekly-harvest-planning.md:337` says the loading_dept_head window *"replaces the previous
warehouse_chief fallback entirely"*. Confirm with the owner before changing anything here.

## P5 — the loading department cannot move a shipment by hand

`TRANSITIONS` gives `warehouse_chief` two edges: creating a `draft` and
`gumruk_chykysh → yuklenme` (Загрузка началась). Neither `loading_dept_head` nor
`loading_dept_head_deputy` appears anywhere in the graph, and there is **no aliasing** —
`TASK_ROLE_EQUIVALENTS` ([roles.py:49-52](../backend/apps/core/roles.py#L49)) maps the head and
deputy onto each other for **Tasks only**, and its comment says so explicitly.

Meanwhile the live accounts are:

| Role | Real users |
|---|---|
| `loading_dept_head` | 1 — Soltanmyrad |
| `loading_dept_head_deputy` | 5 |
| `warehouse_chief` | 1 — "Anwar Test", a seed account |

The org moved: `roles.py:94` records *"May 2026: warehouse_chief replaced by loading_dept_head
(Soltanmyrat) for forecast writes"*, and `weekly-harvest-planning.md:337` says the same for the
forecast window. That migration reached `HARVEST_DAY_WRITE`, `DOMESTIC_WRITE`, `PALLET_WRITE_ROLES`
and the delegated-user-management rules — **but not `TRANSITIONS`**.

Consequence: the people who actually load the trucks cannot press "Изменить статус →
Загрузка началась". Creating drafts still works (that goes through `create_shipment` and
`shipment.can_create`, which `loading_dept_head` holds — not through the `None→draft` edge), and
`yuklenme` can still fire by itself through auto-advance off an ordinary edit. So this is not
visibly broken day to day, which is probably why it survived.

**Not filed as a bug** — it may be deliberate that only `warehouse_chief` marks loading. Needs
an owner decision: either add the loading roles to those two edges, or confirm
`warehouse_chief` is still the intended actor and give a real person that role.

## F15 — admin panel cannot add or delete Tasks (added 2026-08-27)

Raised by owner while asking why old-week Board tasks accumulate and why admin can't remove
them. Two separate gaps:

1. **No task creation.** `TaskViewSet` docstring says *"Tasks are NOT created via POST —
   generation is owned by the rule engine... Manual ad-hoc tasks are a future feature"*
   (`export/views.py:3749-3751`). No admin UI to hand-create a Task exists.
2. **No task deletion.** `TaskViewSet(ReadOnlyModelViewSet)` (`export/views.py:3746`) has no
   `destroy()` — DELETE isn't routed for anyone. The one admin-permitted removal-adjacent
   action, `cancel` (`_CANCEL_ROLES = {admin, director}`, `permissions.py:14`), has no
   frontend caller — `useTaskActions.ts` only wires `start/block/unblock/complete`.

Related, narrower gap in the Sheet drawer: `CommentViewSet.destroy()` gates deleting other
users' comments/tasks on `PRIVILEGED_ROLES = {export_manager, director, boss}`
(`services/shipment.py:44`), no `is_superuser` bypass — `admin` is excluded there too. Same
name, different membership than `core/roles.py:84` — see P4.

Not fixed here — recorded for later by instruction, same as the rest of this file.

## The two root causes

Most of the read-exposure findings are one mistake repeated:

**`write_permission(*roles)` gates writes only.**
[core/permissions.py:152-170](../backend/apps/core/permissions.py#L152-L170) begins
`if request.method in SAFE_METHODS: return True`. Four viewsets use it as though it gated
reads. Page visibility then hides the screen while the API keeps serving the data.
→ F2, F3, F4, and the same shape in F9/F10.

**`DynamicResourcePermission` maps every POST to `can_create`.**
A POST that is *not* a creation — a state transition, a manifest close, a sales report —
is checked against the wrong flag. `ShipmentViewSet.get_permissions` already carries three
hand-written exemptions for exactly this, each commented as "would wrongly block" the role
that owns the work. `transition` never got one.
→ F12.

---

## Detail pointers

- **F1–F5** (greenhouse, transport, feedback): [ROLE_ACCESS_AUDIT.md](ROLE_ACCESS_AUDIT.md#f1--critical-any-authenticated-user-can-overwrite-a-blocks-harvest-forecast)
- **F6–F11** (export): [ROLE_ACCESS_AUDIT.md](ROLE_ACCESS_AUDIT.md#f6--high-greenhouse_manager-sees-the-shipments-nav-link-and-every-call-behind-it-403s)
- **F12–F14** (write path): [ROLE_ACCESS_AUDIT.md](ROLE_ACCESS_AUDIT.md#f12--high-post-transition-is-unreachable-for-the-roles-that-own-the-steps)
- **P1–P4** (process/data divergences): [ROLE_PROCESS_TEST_PLAN.md](ROLE_PROCESS_TEST_PLAN.md#2-four-data-vs-code-divergences-found)
- **T1–T2** (accounts): [TEST_ACCOUNTS.md](TEST_ACCOUNTS.md)

## Verified clean — do not re-investigate

- `core/team-kpi/`, `core/worklog/team/` open to everyone — ADR-020's locked "radical
  transparency" decision (`docs/ADR.md:122`).
- Reference data (`customers`, `export-firms`, `countries`, `cities`, …) readable by all —
  deliberate platform-wide pattern, pinned by `apps/core/tests_reference_data_perms.py`.
- AD-15 permission-matrix endpoints — `_AdminOnlyPermission` correctly refuses `boss` and
  `director`.
- `feedback/tickets/` — `get_queryset` correctly scopes non-admins to own + public.
- `me/tasks/`, `me/kpi-today/` — user-scoped.
- `dashboard/summary/`, `kpi/dashboard/`, `kpi/by-phase/` — documented as open to all roles
  by design.
- `production-analysis/` — 403s exactly the roles lacking `export.pomidor_dukany`.
- `/cancel/` role gate — matches its docstring; `boss` is correctly refused. (I reported
  this as broken earlier and was wrong — it was the `PRIVILEGED_ROLES` name collision, P4.)

## Not determinable yet

`harvest-forecast/`, `harvest-forecast/remaining/`, `kpi/by-role/` returned 400 for every
role (missing required query params), so the sweep never reached their permission gate.
Re-test with real params.
