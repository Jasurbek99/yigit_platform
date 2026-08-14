# Join Supply on the Detail Page (Phase A) — Design

**Date:** 2026-08-14
**Branch:** to be created (`feat/join-supply-detail`)
**Feature:** Bring the shipment Join (merge a supply draft into a destination draft) onto the Detail page — the loading half is picked and merged from the destination draft's own page, outside the Sheet.

Part of the larger "join outside the Sheet" work. **This spec is Phase A only** (Detail page). Phase B (List-page select-two-and-join) is a separate later spec.

---

## 1. Scope

Today the Join lives only in the Sheet: the user arms a join mode, clicks two draft columns, and a `JoinActionBar` merges the supply draft (source, hard-deleted) into the destination draft (target). The backend `POST /export/shipments/{target}/join/` endpoint is done and covered.

**Phase A:** on a **destination draft's** Detail page, a **"Join supply"** button opens a modal listing the available **supply drafts**; the user picks one; it is merged into the current shipment. The current (destination) shipment survives and gains the blocks; the supply draft is hard-deleted (existing backend behaviour).

Backend endpoint and merge logic are unchanged — this is a frontend feature plus two small backend hygiene fixes.

---

## 2. Decisions (product owner)

| # | Decision |
|---|---|
| 1 | Do Phase A (Detail) first, Phase B (List) separately later. |
| 2 | **One direction only:** the button appears on a **destination draft** and picks a **supply draft** to merge in. Not the reverse (no "Join" on a supply draft picking a destination) — that would delete the page's own shipment and force a redirect. |

---

## 3. The Detail-page button

**Placement:** the hero action cluster in `frontend/src/components/shipment/ShipmentDetailHero.tsx` (the `<Flex>` holding Promote / Transition / Cancel), next to **Promote** — both are draft-lifecycle actions.

**Visibility gate** — a local `canJoinSupply` boolean, following the existing hardcoded-role pattern the hero uses for Promote/Cancel (a comment cites the backend source of truth). Shown only when ALL hold:
- `shipment.status_code === 'draft'`
- `shipment.country != null && shipment.customer != null` (has a destination)
- `shipment.block_sources.length === 0` (no blocks yet — a destination draft, not already merged)
- `user.role ∈ {export_manager, director, boss}` OR `user.is_superuser` (mirrors backend `PRIVILEGED_ROLES`, `apps/export/services/shipment.py:44` — note this INCLUDES `boss`, unlike the Promote gate which omits it)
- `!isReadOnly` (season write-freeze)

`IShipmentDetail` already exposes `status_code`, `country`, `customer`, `block_sources` — no extra fetch to classify the current shipment.

The classification (`status_code==='draft' && country!=null && customer!=null && block_sources.length===0`) reuses the same predicate as `isDestinationDraft` — see §5.

---

## 4. `JoinSupplyModal`

**New component:** `frontend/src/components/shipment/JoinSupplyModal.tsx` (≤150 lines). Props: `{ open: boolean; targetId: number; onClose: () => void; onSuccess?: () => void }`.

**Candidate list:** `useDrafts()` (`frontend/src/hooks/useDrafts.ts`) — `GET /export/shipments/?status_code=draft&…`, which returns `ShipmentDraftListSerializer` including `block_sources` (verified: `DraftPool.tsx` already renders `draft.block_sources`). Filter client-side to candidates that are **supply-shaped and joinable**:
- `d.id !== targetId` (not the current shipment)
- `d.block_sources.length > 0` (has blocks — supply-shaped)
- NOT a complete destination itself: `!(d.country != null && d.customer != null)` — so a half-built destination draft that happens to carry blocks is never offered as a "supply" to merge in.

`created_by_role` (the Sheet's extra supply signal in `isSupplyDraft`) is **not** on the draft-list payload (see §5/§6) and is not needed here: "has blocks and is not a complete destination" is an unambiguous supply shape, and the backend join guard is the final safety net (a mis-picked target-with-blocks fails with a clear 400).

**Each candidate row shows:** shipment code, its block codes (`block_sources.map(b => b.block_code).join(', ')`), the declared total weight (`weight_net`), and freshness/age if readily available on the draft payload. Single-select (radio or clickable row).

**Confirm:** calls `useJoinShipments().mutate({ targetId, sourceId: pickedId })`.
- **On success:** toast success; `onSuccess?.()`; close. The hook already invalidates `['drafts']`, `['shipments']`, `['shipments','sheet']` and the target's detail key — so the Detail page refetches and the merged blocks appear. No navigation.
- **On error:** surface the backend message — `err.response?.data?.error` (the endpoint returns distinct 400 strings: "Target shipment already has supply blocks…", "Source shipment has no supply blocks", etc.), falling back to a generic i18n error. Reuse the exact error-extraction shape from `JoinActionBar.handleConfirm`.

**Empty state:** if no candidates, the modal shows "no supply drafts available to join" rather than an empty list.

**i18n:** new `join_supply.*` keys (title, confirm, empty-state, toast success/error, column labels) in all three of `tk.json`/`ru.json`/`en.json`, each its own language.

---

## 5. Reuse & the classifier signature

- **`useJoinShipments`** (`useDrafts.ts:377`) — used as-is. `{targetId, sourceId} → POST /join/`, invalidates the right caches, returns `{id}`.
- **Classifiers** (`frontend/src/components/sheet/joinHelpers.ts`) — `isDestinationDraft` / `isSupplyDraft` are pure but typed against `IShipmentSheetItem`. **Widen their parameter type** to a minimal structural interface (`{ status_code, country, customer, block_sources, created_by_role? }`) so both the Sheet and the Detail page can call them without depending on `IShipmentSheetItem`. `created_by_role` becomes optional (the draft-list payload lacks it; `isSupplyDraft`'s `created_by_role` clause is a secondary OR only reached when `country !== null`). Keep `SUPPLY_ROLES` exported. The Detail hero uses `isDestinationDraft(shipment)` for the button gate; the modal uses `block_sources.length > 0` for candidate filtering (simpler and sufficient there).
- **`JoinActionBar`** (Sheet) — **not reused as a component** (hard-wired to `useSheetStore`). Only its ~15-line classify+confirm+error logic is the pattern the modal follows with its own local `useState` selection.

---

## 6. Type fix

`IShipmentDraft` (`frontend/src/types/index.ts`) under-declares fields the backend already sends. For the modal's candidate rows, ensure the type exposes what the rows render — at minimum `block_sources`, `weight_net`, `shipment_code`; add `country_name`/`customer_name` if a row shows them. Widen the type to match `ShipmentDraftListSerializer`'s real output (don't invent fields the backend doesn't send; `created_by_role` is genuinely absent from this endpoint).

---

## 7. Backend hygiene (fold into this phase)

Two small pre-existing issues in the join area, fixed here so Phase A ships on a clean base:

1. **`tests_shipment_join.py` lacks `seed_permissions`** → ~28/34 tests are pre-existing RED (every non-superuser POST 403s at the permission matrix before reaching the view). Add `call_command('seed_permissions')` to the shared `setUp`/`setUpTestData` (matching the ~54 other test files) so the join endpoint's own tests become a trustworthy green regression gate. This does NOT change join logic — it fixes the test harness. Verify the file goes green after.
2. **Stale 403 message** — the join endpoint returns "Only export_manager or director can join…" but `boss` is also in `PRIVILEGED_ROLES`. Correct the message text (one line). Not behaviour, just accuracy.

Neither changes the merge logic; both are near-zero-risk and make the phase's regression net real.

---

## 8. Testing

**Frontend (`JoinSupplyModal.test.tsx`):**
- Renders candidate supply drafts from a mocked `useDrafts` (blocks + weight visible); excludes the target's own id.
- Empty candidate list → shows the empty state, confirm disabled.
- Pick a candidate + confirm → `useJoinShipments().mutate` called with `{ targetId, sourceId: <picked> }`.
- Backend error (`{error}`) → surfaces that message (mock the mutation's `onError`).

**Frontend (hero):** the `canJoinSupply` gate — button present for a destination draft + privileged role; absent for a non-draft / a draft with blocks / a non-privileged role. (A small render test or extend an existing hero test.)

**Backend:** after adding `seed_permissions`, `tests_shipment_join` is green (run it; report the count). No new backend logic tests needed (endpoint unchanged).

---

## 9. Out of scope
- **Phase B** — List-page select-two-drafts-and-Join (needs on-demand detail fetch for the 2 selected rows, since list rows lack `block_sources`/`country`/`created_by_role`). Separate spec.
- Reverse-direction join (from a supply draft's page).
- Any change to the join merge logic, the Sheet's join UI, or the backend endpoint's behaviour.
- Quota enforcement on join (pre-existing gap, unchanged).

---

## 10. Open questions / risks
1. **Freshness/age display** — whether the candidate row shows draft age depends on what the draft-list payload readily exposes; if it's not there cheaply, omit it (not core).
2. **Concurrent join** — two managers joining the same supply draft into different destinations: the backend locks rows and re-validates under lock, so the second attempt gets a clean 400 (source already deleted → 404, or target-has-blocks). The modal surfaces that error; acceptable.
