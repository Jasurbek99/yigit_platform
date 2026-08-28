---
title: Status Codes
tags: [reference, lifecycle, statuses]
---

# Shipment Status Codes

> Complete reference for the **state machine v2** statuses: 12 active steps + `cancelled` + 3 retired codes.
> Source of truth: `apps/core/migrations/0010_state_machine_v2.py` (rows) and
> `apps/export/services/shipment.py::TRANSITIONS` (edges).

## Active Status Table

Statuses advance **automatically** when the operator fills the trigger field on the Sheet — see
[[../processes/shipment-lifecycle#Sheet-Driven Auto-Advance (v2)]]. The "Trigger field" column is the
cell that, once filled, resolves the step's tasks and fires `transition_to()`.

| Step | Code | Name (TK) | Name (EN) | Name (RU) | Phase | Required Role | Trigger field(s) → next |
|------|------|-----------|-----------|-----------|-------|---------------|--------------------------|
| 0 | `draft` | Garalama | Draft | Черновик | DRAFT | warehouse_chief | `country`+`customer`+`import_firm`, `firm_splits`, `driver_name`+`driver_phone`+`truck_plate`, `documents_status == 'ready'` |
| 1 | `gumruk_girish` | Gümrük girizilmesi | Customs Entry | Передача документов на таможню | CUSTOMS | document_team | `customs_exit_at` |
| 2 | `gumruk_chykysh` | Gümrükden çykyş | Customs Exit | Выход с таможни | CUSTOMS | document_team | `loading_started_at` |
| 3 | `yuklenme` | Ýüklenme | Loading | Погрузка | LOADING | warehouse_chief | `shipment_code`+`block_sources`+`variety`+`weight_net`, `departed_at` |
| 4 | `yola_chykdy` | Ýola çykdy | Departed | Отправлен | TRANSIT | document_team | `border_crossed_at` |
| 5 | `serhet_gechdi` | Serhet geçdi | Crossed TM Border | Пересёк TM границу | BORDER | transport | `dest_entry_at` |
| 6 | `dest_entry` | Barýan ýurduna girdi | Destination Entry | Въезд в страну назначения | BORDER | sales_rep | `customs_entry_at` |
| 7 | `barysh_gumrugi` | Baryş gümrugi | Dest. Customs | Таможня назначения | BORDER | sales_rep | `peregruz_date` (fork) / `arrived_at` |
| 8 | `transshipment` | Peregruz | Transshipment | Перегрузка | SALES | sales_rep | `arrived_at` |
| 9 | `bardy` | Bardy | Arrived | Прибыл | SALES | sales_rep | `city`, `sale_started_at` |
| 10 | `satylyar` | Satylýar | Selling | Продаётся | SALES | sales_rep | `sale_ended_at` |
| 11 | `satyldy` | Satyldy | Sold (waiting for Report) | Продано (ждёт отчёт) | SALES | sales_rep | `sales_report` |
| 12 | `tamamlandy` | Tamamlandy | Report received & Completed | Отчёт получен и завершено | COMPLETE | finansist | _(terminal)_ |
| 99 | `cancelled` | Ýatyryldy | Cancelled | Отменён | CANCELLED | _(none)_ | _(terminal — `/cancel/` only)_ |

`transshipment` (step 8) is **conditional**: `barysh_gumrugi` forks to it only when `has_peregruz=True`.
Otherwise the chain skips straight to `bardy`.

## Retired Codes

Kept in the DB with `is_active=False` and `step_order` 100+ so old rows and audit trails still resolve.
Never a transition target. Existing shipment rows were remapped by
`apps/export/migrations/0021_remap_retired_statuses.py`.

| Code | Retired because | Remapped to |
|------|-----------------|-------------|
| `serhet_tm` | Merged — one border step is enough | `serhet_gechdi` |
| `yolda` | Redundant with the destination-side steps | `barysh_gumrugi` |
| `hasabat` | Merged — report receipt closes the shipment | `tamamlandy` |

## Phase Grouping

Two different "phase" vocabularies exist — do not mix them (see [[../../DECISIONS.md]] / memory note
*Two Phase Taxonomies*):

**1. `ShipmentStatusType.phase` (DB column)** — what `?phase=` on the list endpoint and `ROLE_PHASE_MAP`
(`my_work`) filter on:

| Phase | Steps |
|-------|-------|
| DRAFT | 0 |
| CUSTOMS | 1-2 |
| LOADING | 3 |
| TRANSIT | 4 |
| BORDER | 5-7 |
| SALES | 8-11 |
| COMPLETE | 12 |
| CANCELLED | 99 |

> ⚠️ **Known gap — `StatusTag` colours are stale.** `frontend/src/components/StatusTag.tsx` keys its
> colour map on `status_display` (= `ShipmentStatusType.name_en`), **not** on phase. v2 renamed most
> names, so only `Loading`, `Customs Entry`, `Customs Exit`, `Departed`, `Arrived` and `Cancelled`
> still hit the map. `Draft`, `Crossed TM Border`, `Destination Entry`, `Dest. Customs`,
> `Transshipment`, `Selling`, `Sold (waiting for Report)` and `Report received & Completed` all fall
> through to grey `default`. Tracked, not fixed.

**2. Kanban phases (`apps/export/services/phases.py::PHASE_MAP`)** — the board column grouping:
`PLAN → PREP → DOCS → LOAD → TRANSIT → DEST → CLOSE`. This is deliberately NOT the state-machine
order (documents start in `draft`/PREP before the truck physically loads).

> ⚠️ **Known gap:** `PHASE_MAP` has no entry for `dest_entry`, `transshipment`, or `cancelled`.
> `get_phase()` falls through to its `'CLOSE'` default, so shipments at those statuses land in the
> board's CLOSE column and are counted as CLOSE by `dashboard_summary` and `kpi`. Tracked, not fixed.

## Lifecycle Timestamps — operator-entered (v2)

**`STATUS_TIMESTAMP_MAP` in `services/shipment.py` is empty.** In v1 (AD-1) each transition wrote a
denormalized timestamp on the Shipment row. In v2 the relationship is **inverted**: the operator types
the timestamp into a Sheet cell, and *that* fires the transition. `transition_to()` now updates only
`status` and `status_changed_at`.

The timestamp columns still exist on `Shipment` and are the trigger fields listed above:
`loading_started_at`, `customs_entry_at`, `customs_exit_at`, `departed_at`, `border_crossed_at`,
`dest_entry_at`, `peregruz_date`, `arrived_at`, `sale_started_at`, `sale_ended_at`.

> Consequence: new shipments show `null` in dashboards until staff fill the cells — the timestamps are
> no longer guaranteed to exist just because a shipment reached the step.

Note `customs_entry_at` changed meaning between versions: in v1 it was step 2 (TM customs entry,
`warehouse_chief`); in v2 it is the **destination** customs trigger on `dest_entry` (`sales_rep`).

## Transition Rules

```
draft → gumruk_girish → gumruk_chykysh → yuklenme → yola_chykdy →
serhet_gechdi → dest_entry → barysh_gumrugi →
    has_peregruz=True  → transshipment → bardy
    has_peregruz=False → bardy
→ satylyar → satyldy → tamamlandy
```

Strictly linear, no skipping, no going back. `tamamlandy` and `cancelled` are terminal.
Every non-terminal status also has a `cancelled` edge.

**Privileged roles** — `PRIVILEGED_ROLES` in `services/shipment.py` = `export_manager`, `director`,
`boss` — bypass the per-edge role check on forward steps. Cancelling uses a **different, deliberately
literal** set: `CANCEL_ROLES` = `admin`, `export_manager`, `director`, and only via
`POST /shipments/{id}/cancel/` with a reason.
