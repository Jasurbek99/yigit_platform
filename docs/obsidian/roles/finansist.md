---
title: Finansist
tags: [role, finansist]
related: [[roles-matrix]], [[advances-reconciliation]], [[shipment-lifecycle]]
---

# Finansist

## Who

**People**: Babageldi
**Role code**: `finansist`

## What They Do

The finansist handles financial tracking — issuing cash advances for export operations and reconciling them against shipments. They trigger the final lifecycle transition (step 13: Completed) after verifying financials.

## Active Lifecycle Steps

Step 13 (they can trigger):
- Step 13: `tamamlandy` (Completed) — financial reconciliation done

## Processes They Participate In

| Process | What They Do |
|---------|-------------|
| [[shipment-lifecycle]] | View all shipments, trigger step 13 (Completed) |
| [[advances-reconciliation]] | Create advances, link to shipments, reconcile |

## Pages They See

Dashboard, Shipment List, Kanban Board, Advances Tracker.

## Key Workflows

1. **Issue advance**: AdvancesTracker → Create → enter amount, purpose, batch code
2. **Link shipments**: Expand advance → link to specific shipments with allocated amounts
3. **Reconcile**: When all allocated → mark as reconciled
4. **Complete shipment**: ShipmentDetail → verify financials → transition to Completed (step 13)
