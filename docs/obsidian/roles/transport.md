---
title: Transport
tags: [role, transport]
related: [[roles-matrix]], [[shipment-lifecycle]], [[truck-allocation]]
---

# Transport

## Who

**People**: Malik, Haltac
**Role code**: `transport`

## What They Do

Transport manages vehicle assignment, border crossing, and the physical movement of trucks. They handle the **TRANSIT phase** (steps 5-6) and have visibility into LOADING and CUSTOMS phases to prepare for departures.

## Active Lifecycle Steps

Steps 5-6 (they can trigger transitions):
- Step 5: `serhet_tm` (TM Border) — truck reached Turkmenistan border
- Step 6: `serhet_gechdi` (Border Crossed) — truck crossed the border

## Key Domain Concepts

- **Peregruz** (transloading): at Kazakhstan hub, cargo may be transferred between trucks. Tracked via `has_peregruz` flag, `peregruz_city`, `peregruz_date` on Shipment.
- **Vehicle condition**: `vehicle_condition` field (OK/ISSUE/BREAKDOWN/RETURNED) — transport reports vehicle state
- **Truck capacity**: Standard 18,500 kg per truck

## Processes They Participate In

| Process | What They Do |
|---------|-------------|
| [[shipment-lifecycle]] | View LOADING-TRANSIT shipments via "My Work", transition steps 5-6 |
| [[truck-allocation]] | View truck allocations (read-only) |

## Pages They See

Dashboard, Shipment List, Kanban Board, Truck Forecast.

## Key Workflows

1. **Track departures**: Shipment List → My Work (LOADING+CUSTOMS+TRANSIT) → monitor departing trucks
2. **Border crossing**: Open ShipmentDetail → transition to TM Border → then Border Crossed
3. **Report issues**: Set vehicle_condition to ISSUE/BREAKDOWN, add comment
