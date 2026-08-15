# Join Two Drafts from the List Page (Phase B) — Design

**Date:** 2026-08-15
**Branch:** to be created (`feat/join-drafts-list`)
**Feature:** Bring the shipment Join (merge a supply draft into a destination draft) onto the **Shipment List** page — select two drafts, click **Join drafts**, and the supply half is merged into the destination half and hard-deleted.

Part of the larger "join outside the Sheet" work. **This spec is Phase B only** (List page). Phase A (Detail page) and Phase C (Create supply draft) are already merged.

---

## 1. Scope

Today Join lives in two places: the Sheet (arm a mode, click two draft columns, `JoinActionBar` merges) and — since Phase A — a destination draft's Detail page ("Join supply" button → pick a supply draft). Phase B adds a third entry point on the **Shipment List**: tick two draft rows, click **Join drafts**, and the same merge runs.

**Frontend-only.** The backend `POST /export/shipments/{target}/join/` endpoint and its merge logic are unchanged and already covered (`tests_shipment_join.py`, 34/34). No new endpoint, no serializer change, no migration.

**Reused from Phase A:**
- `joinHelpers` classifiers `isDestinationDraft` / `isSupplyDraft` (already widened to the structural `IJoinClassifiable`; `IShipmentDetail` satisfies it directly).
- `useJoinShipments()` (`{ targetId, sourceId } → POST /join/`, invalidates the right caches).
- The backend error-extraction shape (`err.response?.data?.error`).

---

## 2. Decisions (product owner)

| # | Decision |
|---|---|
| 1 | **Selection surface:** the existing bulk-action bar in `ShipmentList.tsx`. Tick two rows (row-selection already exists); a **Join drafts** button appears in that bar. No dedicated drafts view. |
| 2 | **Direction:** **auto-detect + confirm**, mirroring the Sheet's `JoinActionBar`. The system detects which selected draft is the destination (target, survives) and which is the supply (source, hard-deleted), then shows a confirm modal stating the detected direction. If it cannot tell, it shows a clear error and does nothing — the backend guard is the final net. |

---

## 3. Trigger & visibility gate

**Placement:** a new **Join drafts** button inside the existing bulk-action bar (`ShipmentList.tsx`, the blue `Flex` that already holds Transition / Delete / Clear and renders only when `selectedRowKeys.length > 0`).

**Visibility** — the button renders only when ALL hold:
- exactly **2** rows selected (`selectedRowKeys.length === 2`),
- **both** selected rows are drafts — `status_code === 'draft'`, which `IShipmentListItem` already carries (no fetch needed for the gate),
- `user.role ∈ {export_manager, director, boss}` OR `user.is_superuser` (mirrors backend `PRIVILEGED_ROLES`, `apps/export/services/shipment.py:44` — INCLUDES `boss`),
- `!isReadOnly` (season write-freeze; the page already computes `isReadOnly`).

Because the gate keys off each selected row's own `status_code`, it does not require the DRAFT phase filter to be active — it appears whenever the two selected rows both happen to be drafts.

**Determining "both are drafts" from selection:** the current page's rows are in `data.results` (`IShipmentListItem[]`). Look up the two `selectedRowKeys` in that array and check `status_code === 'draft'` on both. `rowSelection` uses `preserveSelectedRowKeys`, so a selected id could sit on a different page than the one currently rendered; if either selected id is not found in the current `data.results`, treat the gate as not-satisfied (button hidden) rather than guessing. Selecting two drafts on one page is the intended flow.

---

## 4. `JoinDraftsModal`

**New component:** `frontend/src/components/shipment/JoinDraftsModal.tsx` (≤150 lines). Props: `{ open: boolean; draftIds: [number, number]; onClose: () => void; onSuccess?: () => void }`.

**Data:** on open, fetch the two drafts' details — two parallel `GET /export/shipments/{id}/` via the existing detail hook `useShipmentDetail(id)` (`@/hooks/useShipmentDetail`; query key from `getShipmentDetailKey`). Because `draftIds` is a fixed-length tuple `[number, number]`, the modal calls `useShipmentDetail` **twice with fixed positions** — never in a loop/`map` (Rules of Hooks). `IShipmentDetail` satisfies `IJoinClassifiable`, so the real `joinHelpers` classifiers run on the fetched objects — no `country_name`-based approximation, no dependence on the drafts-list page cap.

**Auto-detect direction:**
- `target` (destination) = the fetched draft for which `isDestinationDraft(x)` is true (country + customer set, no blocks).
- `source` (supply) = the fetched draft for which `isSupplyDraft(x)` is true (has blocks).
- The click order of the two rows is irrelevant; direction is derived from shape.

**States:**
- **Loading:** while the two details are in flight — a `Spin`, no premature error (Phase A's loading-flash lesson).
- **Resolved (unambiguous):** exactly one draft is the destination and the other is the supply → show the preview: supply code, destination code + country/customer, and that the supply will be deleted. Confirm enabled.
- **Ambiguous:** both are supply-shaped (both have blocks), or neither qualifies as a destination (target lacks country+customer, or both lack blocks) → show a clear error message, Confirm disabled, no mutation.
- **Fetch error:** surface an error with a retry/close.

**Confirm:** `useJoinShipments().mutate({ targetId: target.id, sourceId: source.id })`.
- **On success:** success toast; `onSuccess?.()` (the List clears `selectedRowKeys`); close. The hook already invalidates `['drafts']`, `['shipments']`, `['shipments','sheet']` and the target detail key — the list refetches and the merged/deleted rows reconcile. No navigation.
- **On error:** surface `err.response?.data?.error` (the endpoint returns distinct 400/404 strings), falling back to a generic i18n error. Reuse Phase A's exact extraction shape.

**i18n:** new `join_drafts.*` keys (button, modal title, confirm, preview line, ambiguity error, fetch error, toast success/error) in all three of `tk.json` / `ru.json` / `en.json`, each its own language.

---

## 5. Reuse & the direction helper

- **Classifiers** (`frontend/src/components/sheet/joinHelpers.ts`) — used as-is; no signature change. `isDestinationDraft` / `isSupplyDraft` already take `IJoinClassifiable`, which `IShipmentDetail` satisfies.
- **`useJoinShipments`** — used as-is.
- **A small pure `detectJoinDirection(a, b)` helper** may be added next to the classifiers (or inline in the modal) returning `{ target, source } | { error: 'ambiguous' }`. Keep it pure and unit-testable; do not couple it to `useSheetStore` (that is why `JoinActionBar` is not reused as a component — only its ~15-line detect+confirm+error pattern is).
- **`JoinActionBar`** (Sheet) — not reused as a component.

---

## 6. Data-source rationale (2 detail fetches vs reusing `useDrafts`)

Chosen: **two `GET /export/shipments/{id}/` detail fetches on modal open.** Rationale:
- `IShipmentDetail` carries the raw `country`/`customer` FK ids, so the **real** classifiers run — no `country_name`-based approximation.
- Independent of the drafts-list serializer's 200-row page cap (a selected draft beyond that cap would be invisible to a `useDrafts`-based lookup).
- Cost is negligible: the fetch fires only when the modal opens, not on selection, and detail queries are cached by React Query.

The alternative (match the two ids inside the cached `useDrafts` payload) avoids a round-trip but reintroduces name-based classification and the page-cap fragility. Rejected for correctness.

---

## 7. Testing

**Frontend (`JoinDraftsModal.test.tsx`):**
- A clean supply + destination pair (mocked details) → correct auto-detected preview; Confirm calls `useJoinShipments().mutate` with `{ targetId: <destination.id>, sourceId: <supply.id> }` regardless of `draftIds` order.
- Two supply-shaped drafts (both have blocks) → ambiguity error shown, Confirm disabled, no `mutate`.
- Backend error (`{ error }`) → surfaces that message (mock the mutation's `onError`).
- Loading state renders while details are in flight (no premature ambiguity/empty flash).

**Frontend (`ShipmentList` gate):** the Join-drafts button — present when exactly 2 selected rows are both drafts + a privileged role; absent for a non-privileged role, for a pair where one row is a non-draft, and for a selection size ≠ 2.

**Backend:** none new — endpoint and guards are unchanged and already covered.

---

## 8. Out of scope
- **Reverse / manual direction** — auto-detect only (product decision #2).
- The **same-season join guard** gap flagged at Phase A merge (`_validate_join` does not assert `source.season == target.season`) — pre-existing backend behavior, a separate concern, not introduced or fixed here.
- Any change to the join/merge logic, the Sheet's Join UI, the Detail-page Join, or the backend endpoint.
- Quota enforcement on join (pre-existing gap, unchanged).
- Joining more than two drafts at once, or across pages of the list.

---

## 9. Open questions / risks
1. **Cross-page selection** — `preserveSelectedRowKeys` lets a user carry a selection across pages; if one of the two selected drafts is not on the currently-rendered page, the gate can't read its `status_code` and hides the button. Acceptable: the normal flow selects two drafts on one page. Documented, not engineered around.
2. **Concurrent join** — two managers joining the same supply draft: the backend locks and re-validates under lock; the second attempt gets a clean 400/404 which the modal surfaces. Same as Phase A.
3. **A draft that is both destination-shaped and carries blocks** — after Phase C a supply draft has blocks but no country/customer, and a destination draft has country/customer but no blocks, so the normal pair classifies cleanly. A draft that somehow has both blocks AND country+customer would be treated as the supply (it has blocks); if the other selected draft is not a clean destination, the pair is ambiguous → error. The backend guard remains the final net.
