---
title: Sales Rep
tags: [role, sales_rep]
related: [[roles-matrix]], [[shipment-lifecycle]], [[price-monitoring]]
---

# Sales Rep

## Who

**People**: Arap, Aganazar
**Role code**: `sales_rep`

## What They Do

Sales reps manage shipments in the destination country — from arrival through selling to final reporting. They handle the **BORDER and SALES phases** (steps 7-12), enter prices, assign cities, and submit sales reports.

## Active Lifecycle Steps

Steps 7-12 (they can trigger transitions):
- Step 7: `barysh_gumrugi` (Destination Customs)
- Step 8: `yolda` (En Route to market)
- Step 9: `bardy` (Arrived at destination)
- Step 10: `satylyar` (Selling)
- Step 11: `satyldy` (Sold)
- Step 12: `hasabat` (Report submitted)

## Processes They Participate In

| Process | What They Do |
|---------|-------------|
| [[shipment-lifecycle]] | View BORDER+SALES shipments via "My Work", transition steps 7-12, submit sales reports |
| [[price-monitoring]] | Enter and view tomato prices across cities |

## Pages They See

Dashboard, Shipment List, Kanban Board, Overdue Reports, Price Panel.

## Key Workflows

1. **Arrival tracking**: Shipment List → My Work (BORDER+SALES) → track arriving shipments
2. **City assignment**: Update city field on arrived shipments
3. **Price entry**: PricePanel → enter daily price per city
4. **Sales report**: ShipmentDetail → Finance tab (at step 12+) → submit sales report with final amounts
5. **Sell flow**: Transition through steps 7→8→9→10→11→12 as shipment sells
