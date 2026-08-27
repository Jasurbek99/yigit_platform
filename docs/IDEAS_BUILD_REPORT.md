# Ideas 1–5 — build report (2026-08-23)

Built by a 12-agent workflow (`wf_be30e084-73a`). Nothing committed. Nothing browser-tested.

Verification, real numbers:
- Frontend: `npx tsc --noEmit --ignoreDeprecations 5.0` clean · `npx vitest run` → **67 files / 499 tests passed**.
- Backend: `makemigrations --check` → no changes · 1742 tests, 42 failures — **0 new**, all 42 proved
  pre-existing (33 match `PRE_EXISTING_TEST_FAILURES.md`, the other 9 reproduced at pristine HEAD `341f4bb`
  in a throwaway worktree). New suites `tests_local_sell_plan_lock` (22), `tests_quota_firm_summary` (14),
  `test_fleet_map_access` (7) all pass.

---

## Idea 1 — Sheet role blocks

The brief's premise was wrong and the agent corrected it: **the Sheet is transposed** — fields are rows,
shipments are columns. So "a block of columns per role" is a contiguous run of *rows* per owner, and the
group header is a full-width band row. The user's own wording ("finding your **row** is very hard") agrees.

- Owner key = the existing `IRowConfig.default_who_key` (already rendered in the "Who" column). It did *not*
  use `swapFieldGroups.ts`: that covers only the swappable subset and disagrees with `default_who_key` on
  `city`, `border_point`, `vehicle_condition`, `vehicle_live_status`, `departed_at` — using it would have
  created the second source of truth the brief forbade. `WeeklyPlanGrid.roles.ts` is role→capability, not
  field ownership; not applicable.
- The first 13 identity/planning rows stay pinned and ungrouped; the remaining 32 group into **9 blocks**.
- Grouping applies only when the prefs query has settled AND the user has no personal row order — otherwise
  a drag would persist the grouped order over their saved positions (permanent loss, not a flash).
- Safety rule: if the row tail is not owner-contiguous, **no bands render at all**. The raw server order has
  29 owner runs across 45 rows, so without this a legacy user would see a band every 1.6 rows.
- Own-block tint is suppressed when every block is editable (a director lights up all nine, so it says nothing).
- Arrow-key scroll maths compensates for band height via one shared `bandHeight()`.

**Open:** collapse was dropped on purpose (a collapsed row is still in `rows`, so arrow-nav lands on a row
with no DOM). The `#` column now reads non-monotonically (13, 14, 16, 18, 19, 35 …) because `display_order`
was deliberately left alone so staff can still cross-reference Shipment Settings → Sheet Rows. Users who
already reordered their rows see no change until they reset their order — there is no "reset" affordance yet.
Five one- and two-row blocks remain (mergen, babageldi, aganazar, haltac, gadam).

## Idea 2 — seller panel: the map

Two of the brief's premises were wrong, and the agent proved it rather than following them:

- There is **no `transport.map` page grant to delete**. `grep` finds no such code in `PAGE_REGISTRY`,
  `seed_permissions` only writes codes in that registry, and `views_permissions.py:107` rejects unknown codes
  from the matrix UI — so `core_role_page_permissions` cannot hold one. **F13 does not apply here, and there is
  no SQL to run.** Read-only confirmation on live:
  `SELECT role, is_visible FROM core_role_page_permissions WHERE page_code = 'transport.map';` → expect 0 rows.
- The sidebar link was already gone (`de01b15`). What was missing was the **server-side gate**: the seller
  could still `GET /transport/live-positions/`.

Shipped: `CanViewFleetMap` + `FLEET_MAP_DENIED_ROLES = {'seller'}` on `LivePositionViewSet`. A deny-list, not a
new page_code — a brand-new page_code lands in the live matrix with zero rows, and both `canSeePage` and the
backend read an absent row as DENY, so shipping it without a data migration would have 403'd the Fleet Map for
all 14 other roles.

**To go live: a backend restart. No migration, no SQL.** Until then a seller still gets 200.

## Ideas 3 + 4 — local sell plan

Statuses are `draft → submitted → approved | rejected`, so the two ideas are not in conflict: fill-empties
applies at *submitted*, the hard lock at *approved*. Backend-first, as required.

- `locked_day_fields(*, is_approver)` on the model: `approved` locks all six days for everyone (admin included);
  `submitted` locks only days already holding a value, and only for non-approvers; `draft`/`rejected` lock nothing.
- `perform_update` rejects with `409 plan_approved_locked` / `409 cell_locked_after_submit` (discriminable from
  core's `season_closed` 409 on the same endpoint). Locks are computed from the pre-save instance.
- Autosave: a save that leaves any day > 0 auto-submits. An all-zero save stays draft. The "Submit All" button
  is gone. `approve` / `reject` / `bulk-approve` untouched and still APPROVE-only; `initialize-week` still on
  LOCAL_SELL_WRITE (`de01b15` not undone).

**Needs your decision — the reject loop.** Autosave + auto-submit + fill-empties compose badly: a week rejected
for three wrong days can be fixed one day per reject cycle. The seller fixes Monday, that save re-submits the
week, and Tuesday/Wednesday re-lock. Same mechanism on a fresh draft — typing `1000` where `10000` was meant
locks that cell in the same round-trip. This follows the spec as written; it is the version most likely to come
back as "the grid is broken".

Also: **no un-approve path** (`approved` is terminal and PATCH was the last way in) — a mis-clicked bulk-approve
freezes a week of firms, repairable only via Django admin or SQL. And a past-week draft can now be submitted
just by typing in it.

## Idea 5 — Quota "Firm Quota" tab

The existing `per_firm` tab is a period-scoped usage funnel; it does not answer "who holds how much right now".
New tab shows per firm: active issuance count, issued / used / **remaining** kg, nearest expiry, expiry warning,
totals row. Backed by `GET /api/v1/export/quota-firm-summary/`, season-scoped, deliberately **not** period-filtered
and deliberately uncached. Season comes from the page dropdown as a parameter, never from the global switcher —
the `92480a9` split-season trap.

**The tab is empty on today's real data, and that is correct.** The newest issuance in the whole database is #32
(2026-06-29, expiring 2026-07-31); today is 2026-08-23, so no quota is live anywhere. Active season 2026-2027 has
no issuances at all. Do **not** reach for `fix_quota_issuance_seasons` — #32 is stamped correctly. The only fix is
real new quota.

---

## Findings from the standards review

The reviewer swept the whole dirty working tree, not just this build's diff. **F-E and F-F are in
`ShipmentFirmSelector.tsx` / `ShipmentDestinationBody.tsx` / `useSetFirmSplits.ts`, which were already
untracked before this workflow ran — they are not from these four ideas.** Everything else below is either
from this build (F-D, F-G, F-H, F-I) or from the earlier role-audit session (F-A, F-B, F-C).

Only F-A was fixed; nothing else was auto-fixed.

| # | Sev | What |
|---|-----|------|
| F-A | **CRITICAL** | `docs/BROWSER_TEST_SCRIPT.md` + `BROWSER_TEST_RU.md` printed the shared test password for `t_director` / `t_boss` / `t_export_manager` next to the beta URL, and are untracked but **not** ignored — one `git add .` would push live director logins. **Fixed: the inline password is removed from both files; they now point at the gitignored `TEST_ACCOUNTS.md`.** The files stay visible in `git status` on purpose — the Russian one is the script currently being used for browser testing. |
| F-B | HIGH | `seed_test_users.py` hardcodes that password across 11 privileged roles with no DEBUG/environment guard, and its docstring says "safe to re-run on any environment". |
| F-C | HIGH | `seed_test_users --delete` cannot delete: it selects by `t_` prefix (would take a real account), and `ShipmentStatusLog.changed_by` is PROTECT, so the batch delete raises `ProtectedError` and removes nothing — exactly when cleanup matters. |
| F-D | HIGH | The reject loop above. |
| F-E | MED | The new firm picker is editable for `document_team`, `transport`, `sales_rep`, `finansist` (they hold `shipment` edit) but the POST maps to `shipment.can_create`, which they do not — a live control that 403s on blur. |
| F-F | MED | `loading_dept_head` / `warehouse_chief` can set firm splits but lack `quota_issuance.can_view`, so the no-quota ⚠ marker silently never renders for them. |
| F-G | MED | The `api-contract` skill is stale: it lacks `/quota-firm-summary/`, the two new 409 codes, and the two fields added to `quota-firm-balances`. |
| F-H | MED | No un-approve path (above). |
| F-I | LOW | The `local_sell_edit` audit row is written before, and outside, the save transaction. |

Skipped by the integrator on purpose: the `display_order` renumber command (a one-shot data mutation for all 45
rows, needs your go-ahead) and a third copy of the 14-role list in `App.tsx`.

## Housekeeping

`PRE_EXISTING_TEST_FAILURES.md` is stale in the project's favour — `tests_field_history`, `SalesReportTest`,
`EndpointSmokeTests` and all of `test_config_api` no longer fail. "71 of 351" is now 42 of 1742.

Two leftover MSSQL test databases on localhost: `test_YGT_VERIFY` (safe to drop) and `test_YIGIT_PLATFROM`
(**possibly half-migrated** — a verifier run was killed mid-migration). The next backend test run must use
`--noinput`, **not** `--keepdb`, or it inherits that state. This warning is also at the top of
`PRE_EXISTING_TEST_FAILURES.md`, where the next run will actually hit it.
