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
| ~~F1~~ | ~~**CRITICAL**~~ | **CLOSED 2026-09-01.** `page_write_permission('export.harvest_board')` now gates board WRITES on the permission matrix (fail-closed, superuser bypass); reads left open on purpose — that is F4 | `greenhouse/views_daily_board.py:78`, `core/permissions.py` |
| ~~F12~~ | ~~**HIGH**~~ | **CLOSED 2026-09-01.** `/transition/` now gates on `shipment.can_edit` (`resource_edit_permission`) instead of inheriting POST→`can_create`; `transition_to()` stays the per-edge authority. Does **not** close P5 — `loading_dept_head` reaches the endpoint and the graph still refuses it | `export/views.py:183-198`, `core/permissions.py` |
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
| F5 | LOW | Transport module open to all — already tracked as an interim choice. **Partially narrowed 2026-08-23**: `live-positions/` now 403s `seller` via `CanViewFleetMap`; every other transport endpoint is unchanged, so this stays open | `transport/views.py` |
| ~~P5~~ | ~~**needs owner call**~~ | **CLOSED 2026-09-01.** `loading_dept_head` + `loading_dept_head_deputy` added to the `gumruk_chykysh → yuklenme` edge; `warehouse_chief` kept, so this widens rather than re-assigns. Two residuals opened below: N1 (notifications) and N2 (should a test-only role keep an edge) | `services/shipment.py:73` |
| ~~N1~~ | MED | **HALF CLOSED 2026-09-01.** `yuklenme` now notifies `loading_dept_head` + deputy. The **`draft`** half is deliberately NOT fanned out — doing so turns 1 dead notification into 15 live ones on every shipment creation; needs an owner call | `services/shipment.py` |
| ~~N2~~ | ~~LOW~~ | **CLOSED 2026-09-01.** `warehouse_chief` removed from `gumruk_chykysh → yuklenme`; its one account has never logged in. Keeps `PALLET_WRITE_ROLES` | `services/shipment.py` |
| P1 | — | `yola_chykdy` owned by `document_team` in code, `transport` in the DB | `services/shipment.py:75` |
| P2 | — | `ShipmentStatusType.step_order` contradicts the real graph | live DB |
| P3 | — | `ShipmentStatusType.required_role` is dead data, read by nothing | live DB |
| P4 | — | Two different role sets share the name `PRIVILEGED_ROLES` | `core/roles.py:84` vs `services/shipment.py:44` |
| F15 | MED | Admin panel has no way to create ad-hoc Tasks or delete/cancel existing ones | `export/views.py:3746` |
| F16 | LOW | nginx forwards `Host $host`, which **drops the port** — every absolute url Django builds behind it is portless | `frontend/nginx.conf:59,79` |
| F17 | LOW | `/static/` has the same missing-location hole `/media/` had; masked by `DJANGO_DEBUG=True` | `frontend/nginx.conf` |
| ~~F18~~ | ~~**HIGH**~~ | **CLOSED 2026-09-01.** `comment` now gates on `shipment_comment.can_create` via `resource_write_permission`, agreeing with `CommentViewSet` instead of contradicting it | `export/views.py:183-194` |
| F19 | MED | `swap` inherits the same wrong flag; latent only because its two callers are privileged screens | `export/views.py:2447` |
| F20 | LOW | `cancel` + `assign` keep a role allowlist in the method body AND pass the `can_create` gate — two sources of truth that agree today | `export/views.py:621,2134` |
| T1 | — | `document_team` account carries role `export_manager` | live DB |
| T2 | — | `export_manager`/`em123` and `document_team`/`dt123` passwords do not work | live DB |
| ~~S1~~ | — | **CLOSED 2026-08-23.** The `QuotaIssuance` half closed via `fix_quota_issuance_seasons`; the one mismatched issuance had already been deleted by the owner. The remaining 6 `WeeklyTruckAllocation` rows (W35/2026) were **deleted** by owner instruction, with their 18 splits | live DB |
| S2 | **needs owner call** | **July 2026 still belongs to no season.** Truck-allocation rows there deleted 2026-08-23; **4 ACTIVE contracts remain stranded** — deleting them is blocked by `PROTECT`ed sales tied to shipments 663/664 | live DB |

---

## F18 / F19 / F20 — the rest of the F12 pattern (added 2026-09-01)

Found by the review of the F12 fix. Same root cause as F12: `DynamicResourcePermission` maps
**every** POST on `ShipmentViewSet` to `shipment.can_create`, and `get_permissions()` needs a
branch per action that is a POST without being a creation. F12 fixed `transition`; these three
are what the same sweep turned up.

### F18 — HIGH: the comment composer is closed to the roles granted commenting

> **CLOSED 2026-09-01.** `get_permissions()` gained a `comment` branch returning
> `resource_write_permission('shipment_comment')` — POST → that resource's own
> `can_create`, which is what `CommentViewSet` has always checked. Confirmed as a
> live bug first: with the seeded matrix all five roles got 403 before the change
> and 201 after. Roles with **no** `shipment_comment` row (`accountant`,
> `greenhouse_manager`, `seller`) stay refused — pinned, along with "a refused POST
> writes no comment row". Tests:
> `TestLegacyCommentEndpointChecksTheCommentResource` in `apps/export/tests_comments.py`.

`POST /api/v1/export/shipments/{id}/comment/`
([views.py:2740](../backend/apps/export/views.py#L2740)) has no branch in `get_permissions()`, so
it falls through to `shipment.can_create`. Live matrix: that flag is **0** for `document_team`,
`transport`, `sales_rep`, `finansist` and `weight_master` — exactly the roles
`seed_permissions.py` grants `shipment_comment.can_create = 1` **so that they can comment**. The
endpoint checks the wrong resource's flag.

Not theoretical: `CommentComposer.tsx`
([:29](../frontend/src/components/CommentComposer.tsx#L29)) POSTs here, and it is the composer
rendered on `ShipmentActivityLog`. A previous author already walked around this without naming
it — `tests_comments.py:257` carries the comment *"is_superuser bypasses
DynamicResourcePermission for this integration test"*, i.e. the test authenticates as a superuser
precisely so it never exercises the broken gate.

**Not affected:** the Sheet's own comment UI goes through `useCreateComment` →
`/export/comments/`, whose `CommentViewSet` sets `resource_code = 'shipment_comment'` and is
correctly gated.

**Fix:** one branch, the same shape as F12 — gate `comment` on `shipment_comment.can_create`.

### F19 — MEDIUM: `swap` has the same hole, currently masked

`swap` ([views.py:2447](../backend/apps/export/views.py#L2447)) has no branch either. Its own
docstring says authorization is per-field via `can_edit_sheet_field`, but the coarse
`can_create` gate runs **first** and would 403 the five `_VE` roles before that logic is reached
— defeating the endpoint's stated design. Latent today because the only frontend callers
(`AssignmentBoard`, `DraftPool`, via `useDrafts.ts:430`) are export_manager/director/boss
surfaces, and `tests_shipment_swap` uses `export_manager` throughout —
`test_permission_denied_returns_403` patches `can_edit_sheet_field` to force its 403 rather than
authenticating as a role that would hit the coarse gate, so the suite cannot see this.

### F20 — LOW: `cancel` and `assign` carry two sources of truth

Both check a role allowlist in the method body (`PRIVILEGED_ROLES`, plus `boss` for `assign`)
**and** still pass through the class-level `can_create` gate. Every role in those allowlists holds
`shipment.can_create = 1` today, so nothing breaks. The risk is drift: widen either allowlist to a
`_VE` role and the coarse gate silently reintroduces F12 for it.

## F16 / F17 — the rest of the `/media/` bug's blast radius (added 2026-08-27)

Both surfaced while fixing the broken signature/seal images and were **deliberately
left unfixed** in that change.

### F16 — nginx forwards `Host $host`, dropping the port

`frontend/nginx.conf:59,79` set `proxy_set_header Host $host`. nginx's `$host` is the
hostname **with the port stripped**, so Django on the beta server (published on
`:8080`) builds every absolute url as `http://10.10.11.25/...` — port 80, where
nothing of ours listens. That is what made the uploaded seals 404 in the browser.

Fixed for media by making those fields return root-relative urls
(`RelativeFileField`), which is immune to the header entirely. **The header is
still wrong for anything else Django makes absolute** — most notably DRF's
pagination `next` / `previous` links.

Not fixed because: the frontend paginates by page number and consumes neither
link (checked across `frontend/src`, no `.next` usage), so there is no live
symptom; and `$host` → `$http_host` forwards a client-controlled value, which
reaches `ALLOWED_HOSTS` validation, django-axes lockout keying and CSRF origin
checks. Worth doing, worth doing on its own, with those three re-checked.

### F17 — `/static/` has the same routing hole `/media/` had

`frontend/nginx.conf` now has a `location /media/`; there is still no
`location /static/`, so Django admin CSS/JS would fall through to the SPA
fallback. Invisible today only because `docker-compose.prod.yml` runs the backend
with `DJANGO_DEBUG=True` **specifically** so Django serves its own static files
(the file says so). Wiring `/static/` through nginx off the existing
`static_files` volume is the prerequisite for turning DEBUG off — already tracked
in `docs/PRE_PRODUCTION_CHECKLIST.md`.

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

> **CLOSED 2026-09-01 — option (a): the loading roles were added to the edge.**
> `TRANSITIONS['gumruk_chykysh']` now reads
> `('yuklenme', ['warehouse_chief', 'loading_dept_head', 'loading_dept_head_deputy'])`.
> `warehouse_chief` was **kept**: this widens the edge, it does not re-assign it, so the
> existing walk and the seed account are untouched and the change reverses in one line.
>
> The "needs owner call" below overstated the ambiguity — the repo had **already** made
> this call for the very same step. `seed_task_rules.py:169` assigns the `yuklenme` task
> to `loading_dept_head` with the comment *"The loading department owns this, not
> warehouse_chief — the latter is a leftover of the May 2026 role change (confirmed
> 2026-07-16: no real user holds it)"*. So the task telling Soltanmyrad to fill
> `loading_started_at` and the transition that field fires disagreed with each other.
> Re-measured on the live DB 2026-09-01: `warehouse_chief` = **1** account ("Anwar Test",
> a seed user); `loading_dept_head` = **2**; `loading_dept_head_deputy` = **6**.
>
> Auto-advance is unaffected either way — `transition_to(is_auto=True)` skips the role
> check entirely, which is what kept this invisible day to day.
>
> Chain worth noting: the button was always *visible* to the loading roles
> (`ShipmentDetailHero` gates on `canDo(user, 'shipment', 'edit')`), **F12** let the
> request reach the service layer, and **P5** is what makes it succeed. The three
> findings were one broken path.
>
> Tests: `LoadingDepartmentOwnsTheLoadingEdgeTests` in `apps/export/tests_role_lifecycle.py`
> — including one asserting the widening is confined to this single edge.
>
> **Two residuals — both answered 2026-09-01, one of them only half:**
>
> **N2 — CLOSED.** `warehouse_chief` was removed from the edge. Four independent
> signals said the role is dead, not merely unused: `last_login` is **NULL** (the
> account has never logged in since it was created 2026-04-06), it has written **0**
> `ShipmentStatusLog` rows, created **0** shipments, and `seed_task_rules.py:169`
> already recorded "no real user holds it (confirmed 2026-07-16)". Leaving a live
> lifecycle edge on a role no human holds is what let the May 2026 drift survive four
> months. It keeps `PALLET_WRITE_ROLES` — different subsystem, and `weight_master`
> shares that list, so pallet work is unaffected. Pinned by
> `test_warehouse_chief_no_longer_owns_the_loading_edge`.
>
> **N1 — HALF CLOSED.** `yuklenme` now notifies `loading_dept_head` +
> `loading_dept_head_deputy` (listed explicitly, because `_notify_action_required`
> uses a plain `role__in` filter and does **not** expand `TASK_ROLE_EQUIVALENTS`).
> Pinned by `test_reaching_yuklenme_notifies_the_loading_department`.
>
> **The `draft` half was deliberately left alone and still needs an owner call.**
> `create_shipment()` calls `_notify_action_required(shipment, 'draft')` on **every**
> shipment creation, and the draft-step `TASK_RULES` assign that work to
> `export_manager` (destination), `document_team` (firm splits, 4 rules) and
> `transport` (driver, 2 rules) — **15 active accounts**. Matching them here would
> turn one dead notification into 15 live ones per shipment, for work the Task engine
> already surfaces as Tasks. That is a user-visible volume change nobody asked for, so
> it is a decision rather than a fix. Three options: (a) leave it dead, (b) drop the
> `draft` key so the dead path stops pretending, (c) fan out to the three task-owning
> roles and accept the volume.
>
> **N1 (MED) — the notification still goes to the seed account.** `STATUS_NOTIFY_ROLES`
> ([shipment.py:103,106](../backend/apps/export/services/shipment.py#L103)) maps `draft` and
> `yuklenme` to `['warehouse_chief']`, and `notify` resolves it with a plain
> `User.objects.filter(role__in=roles, is_active=True)` — **no `TASK_ROLE_EQUIVALENTS`
> expansion**. So when a shipment reaches `yuklenme` the action-required notification is
> delivered to "Anwar Test" and to nobody who loads a truck. Adding both loading roles
> would take those two statuses from 1 recipient to 8, and the `draft` half would fire on
> every supply-draft creation — different blast radius from the edge change, so it needs
> its own decision rather than riding along.
>
> **N2 (LOW) — should `warehouse_chief` keep the edge at all?** Keeping it was the safe
> move today. Whether a role held only by a seed account should own a lifecycle edge is a
> narrowing decision, and narrowing is not reversible the way widening is.

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

## F5 — partially narrowed 2026-08-23 (the rest stays open)

`GET /transport/live-positions/` — the single endpoint the Fleet Map page reads — is now
gated by `CanViewFleetMap` (`apps/transport/permissions.py`), a deny-list holding
`{'seller'}` per the owner's request that the seller's panel lose the map.

**This clears none of F6 / F7 / F8.** Those are dead *menu links* — a page grant with no
matching resource grant, so the link renders and every call behind it 403s. The Fleet Map
had the mirror-image problem (a link with no gate at all behind it), and the fix here adds
**no page grant**, so nothing in the F6/F7/F8 shape is touched. Fixing those means removing
page grants in `seed_permissions.py` **and** flipping the already-written rows in the live
DB — `seed_permissions` only `get_or_create`s and can never heal drift (F13).

What is still open under F5, unchanged: `/transport/devices/`,
`/transport/shipments/{id}/position/`, and the fleet-CRUD reads
(`truck-heads/`, `trailers/`, `drivers/`) remain readable by all 15 roles. Pinned as
deliberate by `test_shipment_position_endpoint_is_unchanged` and
`test_device_list_endpoint_is_unchanged` in `apps/transport/tests/test_fleet_map_access.py`,
so a future narrowing is a conscious edit rather than a silent one.

---

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
