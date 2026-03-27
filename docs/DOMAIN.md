# YGT Platform — Domain Knowledge

## Company
YGT Holding (Turkmenistan) — greenhouse tomato cultivation and export. Platform replaces Excel-based operations across 9+ roles in TM, KZ, RU.

## 5 Modules (build order)
1. **P3 Export** (CURRENT): shipment lifecycle, quotas, weekly planning
2. **P4 Contracts**: contract management, document auto-generation
3. **P2 Transport**: fleet management, driver assignment, GPS tracking
4. **P5 Finance**: payments, reconciliation, Logo Tiger ERP integration
5. **P1 Greenhouse**: cultivation tracking, harvest recording, quality inspection

## Shipment lifecycle

Two separate systems:

**Pre-shipment planning** (dedicated tables, before shipment record exists):
- 0a. Weekly Plan → `export.weekly_harvest_plans` (15 blocks x 6 days)
- 0b. Truck Count → `export.weekly_truck_allocations` (÷18,500 kg = trucks)
- 0c. Country Decision → Gadam decides based on prices, stored when shipment created
- 0d. Firm Selection → Gadam + Aganazar, 1-3 export firms + import firm
- 0e. Transport Plan → Malik/Haltac assign truck + driver

**Shipment status tracking** (13-step state machine on `export.shipments`):
```
LOADING:  1 yuklenme → 2 gumruk_girish → 3 gumruk_chykysh
TRANSIT:  4 yola_chykdy → 5 serhet_tm → 6 serhet_gechdi → 7 barysh_gumrugi → 8 yolda
SALES:    9 bardy → 10 satylyar → 11 satyldy → 12 hasabat
CLOSE:    13 tamamlandy
```

## Roles and active windows

| Role | Person(s) | Active window (step_order) |
|------|-----------|---------------------------|
| Export Manager | Gadam (head), Aganazar | 1-13 (everything) |
| Head Greenhouse Export | Soltanmyrat | 1 (loading only) |
| Document Team | Shohrat, Shirin, Sulgun, Aynur | 1-6 (loading → border crossed) |
| Transport | Malik, Haltac | 1-9 (loading → arrived) |
| Quality Inspector | Per greenhouse | 1 (loading only) |
| Sales Rep | Arap, Aganazar | 7-12 (dest customs → report) |
| Finansist | Babageldi | 1-13 (full lifecycle) |
| Block Managers (7) | Toyly, Guwanç, Geldimyrat, Asdan, Mekan, Batyr, Bayram | Weekly plan grid only |
| Management | Directors | 1-13 (read-only) |

ALL roles see ALL shipments in the main list (like current Excel). Active window is a "my work" filter.

## Key domain facts
- **Cargo code**: `DDMM###/YY` — universal key across all data. DB column: `export.shipments.code`
- **Weight**: `weight_net_kg` (r) = arassa agramy (pure tomato), `weight_gross_kg` (h) = with boxes
- **Truck capacity**: 18,500 kg standard export. Gapy Satys can exceed.
- **Firms**: ~24 export (holding-related), ~111 import. 1-3 export firms per shipment via `shipment_firm_splits`.
- **City decided late**: destination city may be NULL until arrival
- **Peregruz**: transloading at KZ hub, tracked via `has_peregruz` flag

## External systems
| System | Role | Integration |
|--------|------|-------------|
| Logo Tiger ERP | Financial truth | READ master data, WRITE completed shipments |
| Trip Management (Django) | Driver cost truth | Shared via truck_head_id, driver_id FKs |
| Navixy GPS | Location truth | Future: Teltonika FMB920 devices |

## Database
DDL v5.1 (`ygt_platform_ddl_v5_1.sql`). SQL schemas: `core.`, `export.`, `contracts.`, `finance.`, `greenhouse.`
