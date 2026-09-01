# End-to-End Process Test Plan — by Role

> Built 2026-08-22 from the **live** DB and the running backend. Read-only: no shipment
> was created, no status moved, nothing written. Companion to `TEST_ACCOUNTS.md`.

## 1. The actual export process

`ShipmentStatusType.step_order` in the DB is **not** the real order and
`ShipmentStatusType.required_role` is **not** the real gate. The authoritative graph is
`TRANSITIONS` in [backend/apps/export/services/shipment.py:67](../backend/apps/export/services/shipment.py#L67),
enforced by `transition_to()` — the only function permitted to change a shipment's status.

| # | Step (tk) | code | Role that may fire it |
|---|-----------|------|-----------------------|
| 1 | Garalama | `draft` | `warehouse_chief` (creates) |
| 2 | Gümrük giriş | `gumruk_girish` | `document_team` |
| 3 | Gümrük çykyş | `gumruk_chykysh` | `document_team` |
| 4 | Ýüklenme | `yuklenme` | `loading_dept_head` (+ deputy) — P5/N2, 2026-09-01 |
| 5 | Ýola çykdy | `yola_chykdy` | **`document_team`** ⚠️ see §2 |
| 6 | Serhet geçdi | `serhet_gechdi` | `transport` |
| 7 | Barýan ýurduna girdi | `dest_entry` | `sales_rep` |
| 8 | Baryş gümrügi | `barysh_gumrugi` | `sales_rep` |
| 9 | Peregruz *(optional)* | `transshipment` | `sales_rep` |
| 10 | Bardy | `bardy` | `sales_rep` |
| 11 | Satylyar | `satylyar` | `sales_rep` |
| 12 | Satyldy | `satyldy` | `sales_rep` |
| 13 | Tamamlandy | `tamamlandy` | `finansist` |
| — | Ýatyryldy | `cancelled` | `admin`, `director`, `export_manager` — via `/cancel/` only |

**Bypasses.** `PRIVILEGED_ROLES = {export_manager, director, boss}` skip the per-step role
check entirely, as do superusers and any auto-advance (`is_auto=True`, audited as such).
So `t_export_manager`, `t_director` and `t_boss` can drive the whole chain single-handed —
useful for a fast smoke run, useless for testing that the gates work.

**The Peregruz fork.** From `barysh_gumrugi` there are two outgoing edges — `transshipment`
(when `has_peregruz=True`) and `bardy` (when it is False). Those predicates steer **auto-advance
only**; a manual `/transition/` ignores them, so `sales_rep` can pick either target by hand
regardless of the flag. Test both branches.

**Draft guard.** A `draft` cannot leave `draft` without `country` **and** `customer` **and**
`block_sources`. Supply-only and destination-only drafts must be joined first
(`/shipments/{id}/join/`). Expect a 400 naming the missing halves, not a 403.

## 2. Four data-vs-code divergences found

1. **`yola_chykdy` is owned by `document_team` in code, `transport` in the DB.** The
   `transport` role **cannot** move a shipment into "Ýola çykdy" — the step the DB says it
   owns. `transport` only gets the *next* edge, `yola_chykdy → serhet_gechdi`. Every
   neighbouring edge is role-coherent and this one carries no explanatory comment
   ([shipment.py:75](../backend/apps/export/services/shipment.py#L75)), unlike the other
   deliberate oddities in that table. Either the DB column or the edge is wrong; they cannot
   both be right. **Decide this before testing the transport role.**
2. **`step_order` contradicts the real graph.** The DB orders `yuklenme` at 1, before both
   customs steps; the real graph runs `draft → gumruk_girish → gumruk_chykysh → yuklenme`.
   Loading happens *after* customs exit, not before it.
3. **`required_role` is dead data.** Grep confirms it is read only by `core/admin.py` and
   `core/serializers.py` — never by `transition_to()`. Anything the UI renders from it is
   decorative. Don't test against it.

4. **Two different role sets share the name `PRIVILEGED_ROLES`, and they are not the same set.**

   | Defined in | Members |
   |---|---|
   | [core/roles.py:84](../backend/apps/core/roles.py#L84) (re-exported by `core/permissions.py:13`) | `admin`, `director`, `export_manager` |
   | [export/services/shipment.py:44](../backend/apps/export/services/shipment.py#L44) | **`boss`**, `director`, `export_manager` |

   They differ by swapping `admin` for `boss`. Consequences, both verified:
   - `transition_to()` uses the **shipment.py** set, so **`boss` bypasses every per-step role
     check** in the lifecycle, while a `role='admin'` user who is *not* a superuser does not —
     and `admin` appears in no ordinary step's edge list, so such an account cannot advance a
     shipment at all.
   - `/cancel/` ([views.py:619](../backend/apps/export/views.py#L619)) uses the **core/roles.py**
     set — `admin`, `director`, `export_manager`, exactly matching its docstring. **`boss` is
     correctly refused here.** The sweep confirms it.

   So the cancel gate is right; the hazard is the shadowed name. Anyone reading `views.py:619`
   and `shipment.py` in the same sitting will draw the wrong conclusion about who can do what —
   the comment at [shipment.py:46-52](../backend/apps/export/services/shipment.py#L46-L52) exists
   precisely because this already caused one near-miss. **Rename one of them.**

Three statuses are `is_active=False` and correctly absent from the graph: `serhet_tm`,
`yolda`, `hasabat`.

## 3. Per-role test script

Run these in order — each role hands off to the next. Log in with the account from
`TEST_ACCOUNTS.md` §A.

| Order | Role | Account | Do this |
|-------|------|---------|---------|
| 1 | `warehouse_chief` | `warehouse_chief` / `wc123` | Create a supply draft (blocks + weight). Confirm it **cannot** advance — expect a 400 naming `country`, `customer`. |
| 2 | `export_manager` | `t_export_manager` | Create the destination half, then Join the two drafts. Confirm the merged row now advances. |
| 3 | `document_team` | `t_document_team` | Fire `gumruk_girish`, then `gumruk_chykysh`. Generate the customs packet. |
| 4 | `loading_dept_head` | `soltanmyrad` | Fire `yuklenme`. Fill the pallet manifest. Repeat as a deputy. `warehouse_chief` must now be **refused** on this step (N2) while keeping its pallet-manifest rights. |
| 5 | `weight_master` | `t_weight_master` | Enter weights on the pallet manifest. Confirm it **cannot** fire any transition. |
| 6 | `document_team` | `t_document_team` | Fire `yola_chykdy` — **not** `transport`, despite the DB (§2.1). |
| 7 | `transport` | `transport` / `tr123` | Fire `serhet_gechdi`. Check the truck shows on the fleet map. |
| 8 | `sales_rep` | `sales_rep` / `sr123` | Walk `dest_entry → barysh_gumrugi → bardy → satylyar → satyldy`. File the sales report. |
| 9 | `finansist` | `t_finansist` | Fire `tamamlandy`. Check advances and prices reconcile. |
| 10 | `director` / `boss` | `t_director` / `t_boss` | Review analytics, stuck shipments, revenue. **`t_boss` must flip the header Edit toggle first** — see `TEST_ACCOUNTS.md` §A. |

**Negative checks worth running** — each should be refused:

| Role | Attempt | Expect |
|------|---------|--------|
| `t_weight_master` | any `/transition/` | 403 — owns no edge |
| `t_accountant` | any `/transition/` | 403 — owns no edge |
| `t_seller` | any `/transition/` | 403 — owns no edge |
| `t_greenhouse_manager` | any `/transition/` | 403 — owns no edge |
| `t_document_team` | `/cancel/` | 403 — cancel is admin/director/export_manager only |
| `t_boss` | `/cancel/` | 403 — correct; `boss` is not in the cancel gate's role set |
| `t_boss` | any ordinary `/transition/` | **200 — boss bypasses every per-step role check. See §2.4.** |
| `t_director` | `admin.permissions` page | 403 — AD-15, admin only |

## 4. What was NOT run, and why

The write half of this plan — actually creating a shipment and walking it through — was
**not executed**. `backend/.env` points the running backend at live `YIGIT_PLATFROM_NEW`,
and a lifecycle run there is not reversible: `transition_to()` writes an audit row per step,
`auto_advance_if_ready` cascades through every pre-satisfied step in one save,
create/edit auto-syncs `QuotaUsageRecord`, `block_sources` roll up into `HarvestDayEntry`
actuals feeding the weekly plan and Pomidor Dükany, and the TaskRule engine spawns Tasks.
Deleting the shipment afterwards reverses none of it.

**To run it for real:** `backend/.env` already carries `TEST_DB_NAME=test_YIGIT_PLATFROM` /
`TEST_DB_HOST=localhost`, and `config/settings.py:171-185` has the branch that uses it.
Bring a second backend up on another port against that DB, run `seed_data` (safe there —
that is what it is for) plus `seed_test_users`, and this whole plan becomes runnable with
real writes and no consequences.
