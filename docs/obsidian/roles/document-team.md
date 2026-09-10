---
title: Document Team
tags: [role, document_team]
related: [[roles-matrix]], [[shipment-lifecycle]], [[quality-documents]]
---

# Document Team

> [!important] Export-manager parity (2026-09-09)
> `document_team` now holds the **same authority as `export_manager` on every operational gate** — the same pages, the same resource CRUD, wildcard field edit, and the Sheet all-cells bypass. The sections below describe the team's day-to-day work, not the ceiling of what they may do. Anything this page says `export_manager` can do, `document_team` can do too.
>
> Beyond the daily work listed here that means: create and cancel shipments, promote a draft to customs, write reference data (countries, cities, customers, blocks), write quota and prices, read the audit log and archived rows, edit **any** Sheet cell regardless of row triggers or locks, and open **Admin → Shipment Settings** to grant a Sheet row to another role.
>
> Still admin-only, for `export_manager` and `document_team` alike: the permission matrix, user create/edit/delete and role changes, and the feedback admin inbox. The document team reads the user list (for the comments/mentions picker) and nothing more.
>
> Mechanism: `EXPORT_MANAGER_LIKE` in `apps/core/roles.py` (code) plus `core/0042_document_team_export_manager_parity` (matrix rows). **Point-in-time** — the two roles hold independent permission rows afterwards, so a later grant to `export_manager` does not propagate. See [[roles-matrix]] and [[../processes/permissions-system#`EXPORT_MANAGER_LIKE` — document_team is an export_manager peer (2026-09-09)]].

## Who

**People**: Shohrat, Shirin, Sulgun, Aynur
**Role code**: `document_team`

## What They Do

The document team handles customs clearance and quality documentation for shipments in the **LOADING and CUSTOMS phases** (steps 1-6). They manage the 4 quality certificates and advance shipments through customs entry/exit.

## Active Lifecycle Steps

Steps 3-4 are their own work (they own the field that triggers each):
- Step 3: `gumruk_chykysh` (Customs Exit) — approve customs clearance
- Step 4: `yola_chykdy` (Departed) — confirm departure

Since the 2026-09-09 parity change they are also in `PRIVILEGED_ROLES` (`apps/export/services/shipment.py`), which bypasses the per-edge role check — so they can walk **any** edge, and cancel a shipment, the same as `export_manager`.

## Processes They Participate In

| Process | What They Do |
|---------|-------------|
| [[shipment-lifecycle]] | View LOADING+CUSTOMS shipments via "My Work", transition steps 3-4 |
| [[quality-documents]] | Toggle 4 certificate checkboxes on ShipmentDetail Document tab |
| [[quota-management]] | Full quota issuance and usage CRUD (was read-only before the 2026-09-09 parity change) |
| [[draft-shipments]] | Create empty draft columns from the Sheet "+" button (added 2026-09-02); **Join** a supply draft into a destination draft (added 2026-09-03) |

## Pages They See

Every page `export_manager` sees (2026-09-09 parity) — in practice the daily set is Dashboard, Shipment List, Kanban Board, Shipment Sheet, Shipment Dashboard, Quota Dashboard, Documents, Contracts, Sales and the Gross-Net catalog, plus Admin → Shipment Settings. The `admin.*` bundle (Firms, Seasons, Blocks, Customers, Truck Destinations, Process Links), the permission matrix, Users and the Feedback admin inbox stay out of reach, exactly as they do for `export_manager`.

## Key Workflows

1. **Daily check**: Shipment List → My Work filter (sees LOADING + CUSTOMS phase) → review pending shipments
2. **Quality check**: Open ShipmentDetail → Document tab → toggle certificate checkboxes
3. **Customs clearance**: Review documents → transition to Customs Exit → transition to Departed
4. **Open a draft row**: Shipment Sheet → "+" → an empty draft column is created (`POST /export/shipments/ {is_draft: true}`), then its cells are typed in. Requires BOTH `shipment.can_create` in the permission matrix AND membership of `allowed_draft_roles` in `ShipmentViewSet.create()` — see [[../processes/draft-shipments#Permissions|Draft Shipments]].
5. **Join two drafts**: Shipment Sheet → **Join** (pick the two draft columns) or Shipment List → tick exactly two draft rows → **Join drafts**; also from a destination draft's Detail page → **Join supply**. All three call `POST /export/shipments/{target_id}/join/` and hard-delete the source. Gated by `apps.core.roles.JOIN_ROLES` (admin / export_manager / director / boss / document_team) — see [[../processes/draft-shipments#Two-column Join flow (coexisting alternative)|Draft Shipments]].
