# Testing Bugs

Bugs found during manual web testing. Newest on top.
Status: 🔴 OPEN · 🟡 INVESTIGATING · 🟢 FIXED (verified by tester)

---

## 🔴 BUG-002 — Harvest board: harvest plan values don't save; Enter clears the input
- **Found:** 2026-07-29 (tester)
- **Where:** `http://<host>:3000/export/harvest-board`
- **Steps:** Try to fill "yesterday remaining" / "today" harvest plan cells → type a value → press Enter.
- **Expected:** Value saves and stays in the cell.
- **Actual:** Nothing saves. Pressing Enter deletes all the text just typed.
- **Severity:** High — planners can't enter harvest data.
- **Status:** Not yet investigated.

---

## 🟢 BUG-001 — Shipments list: status filter dropdown does nothing
- **Found:** 2026-07-29 (tester)
- **Where:** `/export/shipments` — the status filter dropdown (Draft / Customs / Selling / etc.)
- **Steps:** Select any status in the filter dropdown.
- **Expected:** List narrows to shipments in that status/phase.
- **Actual:** Nothing changes — same 130 shipments regardless of chosen status.
- **Severity:** Medium — filtering by status is unusable.
- **Root cause (confirmed via browser repro):**
  - The earlier "phase value mismatch" guess was **wrong** — DB `ShipmentStatusType.phase`
    values match the dropdown keys exactly (DRAFT/CUSTOMS/LOADING/TRANSIT/BORDER/SALES/
    COMPLETE), and the backend filter (`views.py` `status__phase=phase`) works at every layer.
  - Real cause was **frontend**: the Select `onChange` called two setters in a row —
    `setPhaseFilter(val)` **and** `setPage(1)` (`ShipmentList.tsx:748`). Each calls
    `setSearchParams`, whose functional updater closes over the render-time `searchParams`
    (react-router 6.30, not a live ref). The second call rebuilt the params from the *stale*
    value (no phase) and its `navigate("?")` clobbered the first `navigate("?phase=DRAFT")`.
    Net effect: URL never gained `?phase`, so no refetch. The Select still *showed* the
    picked status because AntD treats `value={undefined}` as uncontrolled.
- **Fix:** Dropped the redundant `setPage(1)` — `setPhaseFilter` already resets page
  (`page: undefined`). One `updateParams` → one `navigate` → filter applies.
- **Verified (Playwright, admin):** picking Draft → URL `?phase=DRAFT`, one request
  `…&phase=DRAFT`, total 131 → 53. **Built — needs tester confirmation.**

---

## 🔴 BUG-003 — Shipments list: search box clears itself (same root cause as BUG-001)
- **Found:** 2026-07-29 (Claude, while fixing BUG-001)
- **Where:** `/export/shipments` — the code/customer search box.
- **Steps:** Type text in the search box.
- **Expected:** List filters by the typed term.
- **Actual:** URL never gains `?search=…`; typing does nothing.
- **Root cause:** Identical double-`setSearchParams` clobber — `onChange`/`onSearch` call
  `setSearch(...)` **and** `setPage(1)` together (`ShipmentList.tsx:740-741`). `setSearch`
  already clears page, so the `setPage(1)` is redundant and wipes the search param.
- **Fix (not applied — out of BUG-001 scope):** remove the redundant `setPage(1)` from both
  the `onChange` and `onSearch` handlers, mirroring the BUG-001 fix.
- **Severity:** Medium.
- **Status:** Open — awaiting go-ahead to fix.
