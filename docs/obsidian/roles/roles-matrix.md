---
title: Roles Matrix
tags: [roles, permissions, matrix]
related: [[permissions-system]]
---

# Roles Matrix

> Master lookup: which role can access which pages, resources, and shipment lifecycle steps.

## Page Visibility Matrix

| Page | admin | export_manager | director | boss | warehouse_chief | document_team | transport | sales_rep | finansist | greenhouse_manager | seller |
|------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Dashboard | Y | Y | Y | - | Y | Y | Y | Y | Y | Y | Y |
| Boss Dashboard (`analytics.boss`) | Y | - | Y | Y | - | - | - | - | - | - | - |
| Shipment List | Y | Y | Y | - | Y | Y | Y | Y | Y | - | - |
| Kanban Board | Y | Y | Y | - | Y | Y | Y | Y | Y | - | - |
| Shipment Sheet | Y | Y | Y | - | - | Y | - | - | - | - | - |
| Shipment Dashboard | Y | Y | Y | - | - | - | - | - | - | - | - |
| Overdue Reports | Y | Y | Y | - | - | - | - | Y | - | - | - |
| Quota Dashboard | Y | Y | Y | - | - | Y | - | - | - | - | Y |
| Weekly Plan | Y | Y | Y | - | - | - | - | - | - | Y | - |
| Price Panel | Y | Y | Y | - | - | - | - | Y | - | - | - |
| Advances | Y | Y | Y | - | - | - | - | - | Y | - | - |
| Truck Forecast | Y | Y | Y | - | - | - | Y | - | - | - | - |
| Block Summary | Y | Y | Y | - | - | - | - | - | - | Y | - |
| Domestic Sales | Y | Y | Y | - | - | - | - | - | - | Y | - |
| Admin Pages (Users, Permissions, Firms, Seasons, Blocks, Customers, Truck Dest, Shipment Settings) | Y | - | - | - | - | - | - | - | - | - | - |

> AD-15: `admin` is the **sole top-tier system administrator** — only role with permission-matrix and user-management access. `director` and `export_manager` lose admin pages but keep all operational power including reference-data writes (countries, cities, customers, blocks). `boss` is read-only and lands exclusively on the Boss Dashboard. See [[boss]], `docs/ADR.md` (AD-15).

## Resource CRUD Matrix

| Resource | admin | export_manager | director | warehouse_chief | document_team | transport | sales_rep | finansist | greenhouse_manager |
|----------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Shipment (view) | Y | Y | Y | Y | Y | Y | Y | Y | - |
| Shipment (create) | Y | Y | Y | - | - | - | - | - | - |
| Shipment (edit) | Y | Y | Y | limited | limited | limited | limited | limited | - |
| Shipment (delete) | Y | Y | Y | - | - | - | - | - | - |
| Quota Issuance | CRUD | CRUD | CRUD | - | view | - | - | - | - |
| Quota Usage | CRUD+approve | CRUD+approve | CRUD+approve | - | view | - | - | - | - |
| Weekly Plan | CRUD+approve | CRUD+approve | CRUD+approve | - | - | - | - | - | CRUD (own blocks) |
| Local Sell Plan | CRUD+approve | CRUD+approve | CRUD+approve | - | - | - | - | - | - |
| Price Entry | CRUD | CRUD | CRUD | - | - | - | CRUD | - | - |
| Advance | CRUD | CRUD | CRUD | - | - | - | - | CRUD | - |
| Truck Allocation | CRUD | CRUD | CRUD | - | - | view | - | - | - |
| Reference Data (Country, City, Customer, BorderPoint, Block, ShipmentStatusType, OptionType, TruckDestination) | CRUD | CRUD | CRUD | - | - | - | - | - | - |
| Permission Matrix (page / resource / field) | CRUD | - | - | - | - | - | - | - | - |
| User CRUD (role / activate / password) | CRUD | - | - | - | - | - | - | - | - |

> **Draft-create (supply column):** `loading_dept_head` (Soltanmyrat) is now also granted shipment-**draft** create — supply-only columns (blocks + variety, no destination) in the [[draft-shipments#Two-column Join flow (coexisting alternative)]] flow. Previously draft-create was limited to `warehouse_chief` + `export_manager`/`director`. The **Join** action that merges a supply draft into a destination draft remains `export_manager`/`director` only.

## Shipment Lifecycle Steps by Role

| Step | Code | Required Role | Privileged Override |
|------|------|---------------|-------------------|
| 1. Loading | `yuklenme` | warehouse_chief | export_manager, director |
| 2. Customs Entry | `gumruk_girish` | warehouse_chief | export_manager, director |
| 3. Customs Exit | `gumruk_chykysh` | document_team | export_manager, director |
| 4. Departed | `yola_chykdy` | document_team | export_manager, director |
| 5. TM Border | `serhet_tm` | transport | export_manager, director |
| 6. Border Crossed | `serhet_gechdi` | transport | export_manager, director |
| 7. Dest. Customs | `barysh_gumrugi` | sales_rep | export_manager, director |
| 8. En Route | `yolda` | sales_rep | export_manager, director |
| 9. Arrived | `bardy` | sales_rep | export_manager, director |
| 10. Selling | `satylyar` | sales_rep | export_manager, director |
| 11. Sold | `satyldy` | sales_rep | export_manager, director |
| 12. Report | `hasabat` | sales_rep | export_manager, director |
| 13. Completed | `tamamlandy` | finansist | export_manager, director |

## "My Work" Filter by Role

When `?my_work=true` is applied:

| Role | Sees Shipments in Phases |
|------|-------------------------|
| `warehouse_chief` | LOADING only |
| `document_team` | LOADING + CUSTOMS |
| `transport` | LOADING + CUSTOMS + TRANSIT |
| `sales_rep` | BORDER + SALES |
| `finansist` | All phases |
| `export_manager` | All phases |
| `director` | All phases |
| `admin` | All phases (and only role with permission-matrix + user-management access — see AD-15) |
