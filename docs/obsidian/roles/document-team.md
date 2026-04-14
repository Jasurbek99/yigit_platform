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

## Pages They See

Dashboard, Shipment List, Kanban Board, Shipment Sheet, Quota Dashboard (read-only tab).

## Key Workflows

1. **Daily check**: Shipment List → My Work filter (sees LOADING + CUSTOMS phase) → review pending shipments
2. **Quality check**: Open ShipmentDetail → Document tab → toggle certificate checkboxes
3. **Customs clearance**: Review documents → transition to Customs Exit → transition to Departed
