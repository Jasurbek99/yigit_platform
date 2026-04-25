---
title: Known Issues
tags: [operations, issues, bugs, feedback]
---

# Known Issues & Feedback Log

> Reverse-chronological log of bug reports, user feedback, and workarounds.
> Use the template in `templates/known-issue-template.md` for new entries.
> Tags: #severity/low #severity/medium #severity/high #severity/critical
> Tags: #status/open #status/investigating #status/fixed #status/wontfix

---

_No issues logged yet. Add entries below as they arise._

---

## 2026-04-24 — Kaka Findings follow-ups (deferred from DRAFT MVP)

- **Reporter**: Kaka site visit (Soltanmyrat, Gadam, Artykow M.), synthesised in [[../../../data/kaka_greenhouse_findings/Kaka_Findings_v1.md|Kaka_Findings_v1]]
- **Severity**: medium (operational reality gap, not a bug)
- **Status**: open
- **Affected**: [[draft-shipments]], [[assignment-board]], [[weekly-harvest-planning]]
- **Description**: The DRAFT MVP (AD-014) covers Findings #1 and #2 only. The following items from the same findings document are deliberately deferred and need their own sprint work.

**Follow-up items:**

1. **Finding #3 — variety-at-packaging rule**
   Block managers cannot give a morning variety breakdown. When a Daily Supply Intake page is built, the UI must have **no variety field** at morning supply. Plantings-per-block are shown as read-only hints only. Variety is captured per pallet later (see #4).
   _Currently not enforced because the supply-intake page doesn't exist._ DraftComposerModal already omits variety — no rework needed there.

2. **Finding #4 — pallet manifest + weight_master role**
   Per-pallet recording by a new `weight_master` role (Artykow Maksat). New entities: `Pallet` (pallet_code, crate_type FK, gross, net derived, variety, sub_block, loaded_at), `CrateType` (e.g. LEBIZ PLAST 18 = 0.543 kg), sub-block FK on `GreenhouseBlock` (F1/F2, D1/D2). Add `is_experimental` flag to `TomatoVariety`. Derive shipment `weight_net` from pallet sum instead of direct entry. Logo Tiger export hook + CMR generation button on the manifest page.

3. **Finding #5 — Soltanmyrat's 5-function role**
   Current TZ gives him 2 roles; reality is 5: supply intake, draft creation, **real-time truck dispatch**, time-stamping, **truck-to-shipment swap**. Needs a new Trucks screen (on-site / en-route / missing groups), swap modal with reason dropdown, `freshness` attribute on drafts/shipments (🟢 today / 🟡 yesterday / 🔴 2+), and expanded role definition.

4. **Finding #5c — Mergen/Dispatcher role decision**
   "Mergen the Dispatcher" is mostly a paper role in practice. Options: (a) collapse into Soltanmyrat, (b) keep but rename to "Time Clerk". Needs stakeholder input from Gadam/Soltanmyrat.

5. **Finding #6 — Received-weight productivity (scope boundary)**
   Productivity dashboard uses **received weight at customer site**, not sent weight at Kaka. Lives outside this platform (Logo Tiger + Sirin's finance spreadsheet). Open questions before integration: who writes the receipt act, what's in it, when does it arrive, via what channel (WhatsApp / email / CMR return). This platform's source of truth stops at the pallet manifest (sent weight).

- **Resolution**: (will be filled as each follow-up lands)
- **Related Commit**: DRAFT MVP commits reference AD-014; see [[decisions-log]].

---

## 2026-04-24 — `create_shipment()` (legacy single-form path) violates AD-1

- **Reporter**: Code review pass after DRAFT MVP landed
- **Severity**: medium (pre-existing violation, no new regression)
- **Status**: open (out of MVP scope)
- **Affected**: [[shipment-creation]]
- **Description**: `backend/apps/export/services.py:230-250` (`create_shipment()`) creates a Shipment with `status=yuklenme` directly in the constructor and writes `loading_started_at = timezone.now()` manually via `save(update_fields=['loading_started_at'])`. This bypasses `transition_to()` and violates AD-1 ("AD-1 denormalized timestamp fields are written ONLY by `transition_to()`").
- **Why it's latent**: The ShipmentStatusLog row is still created, so audit history exists. The difference is that `transition_to()` also writes an `AuditLog` entry and fires `_notify_action_required`, both of which this path skips.
- **Why not fixed in the DRAFT MVP**: The MVP scope (Kaka Findings #1+#2) was draft creation and assignment. The new `_create_draft_shipment` + `assign` pair is AD-1-clean. The legacy `create_shipment()` path was pre-existing and used by `ShipmentCreateModal` for direct single-form creation. Fixing it would require either:
  1. Adding back the `None → yuklenme` transition edge (removed by this MVP, which now routes `None → draft`) AND creating the Shipment with `status=None` first (which conflicts with the current NOT-NULL status FK); or
  2. Retiring `create_shipment()` entirely and migrating `ShipmentCreateModal` to the two-phase flow.
- **Resolution**: Choose one of the two paths above in a follow-up sprint. Prefer path 2 — the two-phase flow matches operational reality per Finding #1 and the single-form path will likely be deprecated.
- **Related Commit**: AD-014 (DRAFT status added, `None` edge re-routed to `draft`).

<!-- 
## YYYY-MM-DD — Short title

- **Reporter**: Name / Role
- **Severity**: low | medium | high | critical
- **Status**: open | investigating | fixed | wontfix
- **Affected**: [[process-name]], [[role-name]]
- **Description**: What happened, expected vs actual behavior
- **Steps to Reproduce**:
  1. ...
- **Resolution**: (filled when fixed)
- **Related Commit**: (filled when fixed)
-->
