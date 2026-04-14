---
title: Status Codes
tags: [reference, lifecycle, statuses]
---

# Shipment Status Codes

> Complete reference for all 13 shipment lifecycle statuses.

## Status Table

| Step | Code | Name (TM) | Name (EN) | Name (RU) | Phase | AD-1 Timestamp | Required Role |
|------|------|-----------|-----------|-----------|-------|----------------|---------------|
| 1 | `yuklenme` | Yuklenme | Loading | Загрузка | LOADING | `loading_started_at` | warehouse_chief |
| 2 | `gumruk_girish` | Gumruk Girish | Customs Entry | Таможня (вход) | LOADING | `customs_entry_at` | warehouse_chief |
| 3 | `gumruk_chykysh` | Gumruk Chykysh | Customs Exit | Таможня (выход) | CUSTOMS | `customs_exit_at` | document_team |
| 4 | `yola_chykdy` | Yola Chykdy | Departed | Выехал | CUSTOMS | `departed_at` | document_team |
| 5 | `serhet_tm` | Serhet TM | TM Border | Граница ТМ | TRANSIT | _(none)_ | transport |
| 6 | `serhet_gechdi` | Serhet Gechdi | Border Crossed | Пересек границу | TRANSIT | `border_crossed_at` | transport |
| 7 | `barysh_gumrugi` | Barysh Gumrugi | Dest. Customs | Таможня назначения | TRANSIT | _(none)_ | sales_rep |
| 8 | `yolda` | Yolda | En Route | В пути | BORDER | _(none)_ | sales_rep |
| 9 | `bardy` | Bardy | Arrived | Прибыл | BORDER | `arrived_at` | sales_rep |
| 10 | `satylyar` | Satylyar | Selling | Продается | SALES | `sale_started_at` | sales_rep |
| 11 | `satyldy` | Satyldy | Sold | Продан | SALES | `sale_ended_at` | sales_rep |
| 12 | `hasabat` | Hasabat | Report | Отчет | SALES | _(none)_ | sales_rep |
| 13 | `tamamlandy` | Tamamlandy | Completed | Завершен | COMPLETE | _(none)_ | finansist |

## Phase Grouping

| Phase | Steps | Color (Frontend) | Overdue Threshold (Kanban) |
|-------|-------|------------------|---------------------------|
| LOADING | 1-2 | Blue | 2 days |
| CUSTOMS | 3-4 | Orange | 2 days |
| TRANSIT | 5-7 | Cyan | 5 days |
| BORDER | 8-9 | Purple (geekblue) | 3 days |
| SALES | 10-12 | Green | 10 days |
| COMPLETE | 13 | _(terminal)_ | _(n/a)_ |

## AD-1 Denormalized Timestamps

8 of 13 statuses write a timestamp directly on the Shipment model (Architecture Decision AD-1). These are set **only** by `transition_to()` in `services.py` — never update directly.

Statuses WITHOUT a dedicated AD-1 field: `serhet_tm` (step 5), `barysh_gumrugi` (step 7), `yolda` (step 8), `hasabat` (step 12), `tamamlandy` (step 13). These are transit waypoints or terminal states without dedicated timestamp needs.

## Transition Rules

Transitions are strictly linear — no skipping, no going back:

```
None → yuklenme → gumruk_girish → gumruk_chykysh → yola_chykdy → 
serhet_tm → serhet_gechdi → barysh_gumrugi → yolda → bardy → 
satylyar → satyldy → hasabat → tamamlandy
```

`tamamlandy` is terminal — no further transitions allowed.

**Privileged roles** (`export_manager`, `director`) can trigger any valid transition regardless of required role.
