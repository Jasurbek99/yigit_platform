---
title: Support Roles
tags: [role, director, warehouse_chief, quality_inspector, seller, accountant]
related: [[roles-matrix]]
---

# Support Roles

Grouped here because they have simpler or derived access patterns.

## Director

**Role code**: `director`

- **Privileged role** — same as export_manager for transition overrides
- Full read access to everything
- Can configure permissions in Admin > Permissions
- Primary difference: oversight and configuration, not daily operations
- See all pages including admin

## Warehouse Chief

**Role code**: `warehouse_chief`

- Active at steps 1-2 (Loading phase)
- Triggers: `yuklenme` (Loading) and `gumruk_girish` (Customs Entry)
- "My Work" filter shows LOADING phase only
- Pages: Dashboard, Shipment List, Kanban Board
- Cannot create shipments or access admin

## Quality Inspector

**Role code**: `quality_inspector` (if configured)

- Step 1 only — inspects produce quality at loading
- Very narrow scope: view shipments, check quality
- May overlap with document_team for quality certificates

## Seller

**Role code**: `seller`

- Limited to Local Sell Plan section of Quota Dashboard
- Manages domestic sale plans for their firm
- Cannot see shipment data or admin pages

## Accountant

**Role code**: `accountant`

- Read-only access to financial data
- May view advances and shipment financial details
- Cannot trigger transitions or create records
