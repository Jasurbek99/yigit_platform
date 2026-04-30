---
title: Export Manager
tags: [role, export_manager]
related: [[roles-matrix]], [[shipment-lifecycle]], [[quota-management]]
---

# Export Manager

## Who

**People**: Gadam, Aganazar
**Role code**: `export_manager`

## What They Do

The export manager is the **primary operational role** with full access to all processes. They oversee the entire shipment lifecycle (steps 1-13), manage quotas, approve harvest plans and local sell plans, and create shipments. Per **AD-15** (Apr 2026), they no longer configure permissions or manage users — those are admin-only.

## Privileged Access

Export managers are in the `PRIVILEGED_ROLES` set — they can trigger **any** status transition regardless of the step's required role. This allows them to handle exceptions and override when the assigned role is unavailable.

## Processes They Participate In

| Process | What They Do |
|---------|-------------|
| [[shipment-lifecycle]] | Full CRUD, trigger any transition, set quality docs, add comments, set firm splits/block sources |
| [[shipment-creation]] | Create new shipments (cargo_code + date + country + customer) |
| [[quota-management]] | Full dashboard access, create/edit/delete issuances, approve usage records |
| [[local-sell-plan]] | Create, edit, submit, approve/reject plans |
| [[weekly-harvest-planning]] | View all blocks, edit all plans, approve/reject submissions |
| [[truck-allocation]] | View and manage truck allocations |
| [[price-monitoring]] | View and manage price entries |
| [[advances-reconciliation]] | Create advances, reconcile |
| [[domestic-sales]] | View and manage |
| [[permissions-system]] | No write access (admin-only since AD-15); reads own permissions via `/auth/me/` |

## Pages They See

All operational pages: Dashboard, Shipment List, Kanban, Sheet, Shipment Dashboard, Overdue Reports, Quota Dashboard, Weekly Plan, Price Panel, Advances, Truck Forecast, Block Summary, Domestic Sales. **Admin pages are no longer visible to export managers** since AD-15 — Users, Permissions, Firms, Seasons, Blocks, Customers, Truck Destinations, and Shipment Settings now require the `admin` role.

## Key Workflows

1. **Morning check**: Open Kanban → see overdue shipments by phase → follow up with responsible role
2. **Create shipment**: ShipmentList → Create button → fill cargo_code, date, country, customer
3. **Approve plans**: WeeklyPlanGrid → review submitted plans → bulk approve/reject
4. **Quota oversight**: QuotaDashboard → check coverage % → create issuances → approve usage
5. **Exception handling**: Transition any stuck shipment to next step (privileged override)
