---
title: Document Team
tags: [role, document_team]
related: [[roles-matrix]], [[shipment-lifecycle]], [[quality-documents]]
---

# Document Team

## Who

**People**: Shohrat, Shirin, Sulgun, Aynur
**Role code**: `document_team`

## What They Do

The document team handles customs clearance and quality documentation for shipments in the **LOADING and CUSTOMS phases** (steps 1-6). They manage the 4 quality certificates and advance shipments through customs entry/exit.

## Active Lifecycle Steps

Steps 3-4 (they can trigger transitions):
- Step 3: `gumruk_chykysh` (Customs Exit) — approve customs clearance
- Step 4: `yola_chykdy` (Departed) — confirm departure

## Processes They Participate In

| Process | What They Do |
|---------|-------------|
| [[shipment-lifecycle]] | View LOADING+CUSTOMS shipments via "My Work", transition steps 3-4 |
| [[quality-documents]] | Toggle 4 certificate checkboxes on ShipmentDetail Document tab |
| [[quota-management]] | Read-only access to "All Quotas" tab |
| [[draft-shipments]] | Create empty draft columns from the Sheet "+" button (added 2026-09-02); **Join** a supply draft into a destination draft (added 2026-09-03) |

## Pages They See

Dashboard, Shipment List, Kanban Board, Shipment Sheet, Quota Dashboard (read-only tab).

## Key Workflows

1. **Daily check**: Shipment List → My Work filter (sees LOADING + CUSTOMS phase) → review pending shipments
2. **Quality check**: Open ShipmentDetail → Document tab → toggle certificate checkboxes
3. **Customs clearance**: Review documents → transition to Customs Exit → transition to Departed
4. **Open a draft row**: Shipment Sheet → "+" → an empty draft column is created (`POST /export/shipments/ {is_draft: true}`), then its cells are typed in. Requires BOTH `shipment.can_create` in the permission matrix AND membership of `allowed_draft_roles` in `ShipmentViewSet.create()` — see [[../processes/draft-shipments#Permissions|Draft Shipments]].
5. **Join two drafts**: Shipment Sheet → **Join** (pick the two draft columns) or Shipment List → tick exactly two draft rows → **Join drafts**; also from a destination draft's Detail page → **Join supply**. All three call `POST /export/shipments/{target_id}/join/` and hard-delete the source. Gated by `apps.core.roles.JOIN_ROLES` (admin / export_manager / director / boss / document_team) — see [[../processes/draft-shipments#Two-column Join flow (coexisting alternative)|Draft Shipments]].
