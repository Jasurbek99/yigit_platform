---
title: Greenhouse Manager
tags: [role, greenhouse_manager]
related: [[roles-matrix]], [[weekly-harvest-planning]], [[domestic-sales]]
---

# Greenhouse Manager

## Who

**People**: 7 block managers, each assigned to 1-3 blocks out of 15 total (blocks A through O)
**Role code**: `greenhouse_manager`

## What They Do

Greenhouse managers plan and record weekly tomato harvest per block. They only see and edit **their assigned blocks** (enforced by `BlockManagerAssignment` table). They also manage domestic sales records for their blocks.

## Block Assignment

Each manager has rows in `greenhouse.block_manager_assignments`:
- `user_id`, `block_id`, `is_active`
- One user can have multiple block assignments
- Their blocks are highlighted (yellow background) in the WeeklyPlanGrid

## Processes They Participate In

| Process | What They Do |
|---------|-------------|
| [[weekly-harvest-planning]] | Enter plan_kg per day for own blocks, submit for approval, enter actual_kg after approval |
| [[domestic-sales]] | Record domestic sale events for own blocks |

## Pages They See

Dashboard, Weekly Plan Grid, Block Summary, Domestic Sales.

## Key Workflows

1. **Weekly planning**: WeeklyPlanGrid → enter Mon-Sat plan_kg for assigned blocks → submit
2. **After approval**: Enter actual_kg per day (only for approved plans, only past/today)
3. **Domestic sales**: DomesticSales → record sales to local buyers from assigned blocks

## Scoped Access

- **Cannot** see Shipment List, Kanban, Quota Dashboard, or Admin pages
- **Cannot** approve/reject plans (only submit their own)
- **Cannot** edit blocks they are not assigned to (API enforces via BlockManagerAssignment check)
