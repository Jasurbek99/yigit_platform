---
title: Tır Takip → Gaplama tab vs our forecast-first drafts
date: 2026-09-18
branch: Copy_Gadams_UI
status: research — no code written
related: docs/TIR_TAKIP_ONUMCILIK_VS_WEEKLY_PLAN.md
---

# Tır Takip · Gaplama tab — how it works, and how it lines up with our forecast-first drafts

> [!important] Correction by the owner, 2026-09-18 — read this first
> The mapping below treats Gaplama's kg as `forecast_value`, typed by the packing head.
> **That is wrong.** The loading department head opens packaging drafts each day from
> the **Weekly Plan** (`plan_value`), and one draft can take kg from several blocks. The
> Gaplama grid is a read-only copy of the plan that goes down as drafts are opened.
> §5 Q1 (write window) therefore no longer applies. The approved design is
> `docs/superpowers/specs/2026-09-18-tir-takip-gaplama-design.md`; follow it wherever
> it disagrees with this note.

Research note for the second tab of `/tir-takip` (`tir_takip.gaplama`, still a
placeholder on `Copy_Gadams_UI`). Source of the design:
`data/sera-butce-web/client/src/App.jsx` — state/handlers at **L12067–L12253**,
the tab body at **L13508–L14016**.

**Headline:** unlike Önümçilik, this tab is **not** a new concept for us. Sera's
Gaplama is our forecast-first draft flow (forecast pool → one-truck drafts →
remaining) under another name. The port is mostly a view; one read endpoint is
missing. The hard part is a write-window collision (§5 Q1).

---

## 1. What the sera tab actually is

One `<Card>`, five stacked parts, no modals.

```
┌─ Gaplama — Günlük Kg Ýazgysy ─────────── [◀ Öňki hepde][Şu hepde][Indiki hepde ▶] ┐
│ 18.09.2026 — 24.09.2026                                                            │
│ "Her gün üçin müdiriň gaplama kg-syny el bilen ýazýar."                             │
│ [block chip selector, grouped Dusak / Kaka / Owadandepe]                            │
│                                                                                     │
│ ① GRID       Blok     │ 18.09 Pş● │ 19.09 Ann │ … │ 24.09 Pş │  JEMI               │
│              Dusak A  │ [ 18500 ] │ [ 17000 ] │ … │ [      ] │ 35 500              │
│              …        │  (every cell a bare number input, anyone may type)          │
│   footer     JEMI kg  │   18 500  │   17 000  │ … │          │ 35 500              │
│              Tır sany — Pomidor (÷18 500) │ 1,00 │ 0,92 │ …     (2 decimals)        │
│              📦 Açylan tırlar │ [24JN001/26 18 500 kg ✕] │ — │ …  │ 1 tır           │
│              Bakiye   │     0 kg  │ 17 000 kg │ …  (red when < 0)                   │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ ② TIR AÇ     [+ Tır Aç] → Export Kody* [18SP001/26]  (pre-filled, editable, required)│
│              1. [Dusak A ▾] [ 12000 ] kg  ✕                                         │
│              2. [Dusak B ▾] [  6500 ] kg  ✕      [+ Blok goş]  Jemi: 18 500 kg      │
│              [Tır Aç] [Ýatyr]                                                        │
│ ─────────────────────────────────────────────────────────────────────────────────── │
│ ③ Blok Bakiyesi — Günlük   block × day of (gaplama kg − kg on trucks), click a row  │
│              to expand into "Gaplama kg" and "Tıra giden (−)" sub-rows              │
│ ④ Blok Bakiyesi — Haftalık Özet   Blok │ Gaplama kg │ Tıra giden │ Bakiye           │
│ ⑤ Açylan Gaplama Tırları   Kod │ Blok(lar) (kg each) │ Kg │ Ýagdaýy │ Senesi │ 🗑    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Parts ③–⑤ render only once at least one gaplama truck exists.

## 2. Exact state inventory (sera)

| state | shape | written by | notes |
|---|---|---|---|
| `gaplamaHaftalikPlan[block][ymd]` | kg | ① grid cell | **reads fall back to `tirHaftalikPlan`** (the Önümçilik value) when unset — so the grid opens pre-filled with the plan |
| `tirList[]` with `openedBy: "gaplama"` | truck object | ② Tır Aç | `blockKgMap {block: kg}`, `kgCapacity` = Σ kg, `isPartial` = Σ < 18 500, `exportKod`, `createdAt` |
| `standartTirKgByCrop[crop]` | kg, default 18 500 | settings | divisor for "Tır sany" |

### The derivations

- **Tır sany** = Σ day kg ÷ truck kg, per crop, **2 decimals** (0,92 of a truck is shown, not rounded).
- **Tıra giden (day D)** = Σ `blockKgMap` of gaplama trucks whose **`createdAt` falls on D**.
- **Bakiye** = gaplama kg − tıra giden. **May go negative** (red); nothing stops over-loading.
- **Export Kody** generator: `DD` + month abbr (`JA FB MR AP MY JN JL AGS SP OC NV DC`) +
  3-digit per-month sequence + `/YY` → `18SP001/26`. Required to open a truck.

### What is NOT in this tab

**Aktar** (copy an Export tır's fields into the matching Gaplama tır, delete the
Export tır) and **Ayyr** (the reverse) live in the **Tırlar** tab (L14191–L14231),
not here. Our Tırlar tab already reuses `SheetGrid`, which has the Join flow — the
same operation.

## 3. Our side — forecast-first drafts

Map as of the `main` working tree, 2026-09-18.

- **Pool**: `HarvestDayEntry.forecast_value` per block-day
  (`backend/apps/greenhouse/models/harvest_day_entry.py:90-121`).
- **Who writes it** — `set_forecast_value` (`greenhouse/services/harvest_day_service.py:364`):
  - admin / boss: any time; reason required when overwriting.
  - greenhouse_manager: own blocks, primary window only.
  - **loading_dept_head (+ deputy): any block, 00:00 the day before → 12:00 on the day**
    (`LOADING_HEAD_FORECAST_DAY_OF_CLOSE`, `:28`, hardcoded).
- **Write endpoint**: `POST /api/v1/export/harvest-forecast/` `{date, entries:[{block_id, forecast_kg}]}`
  → `set_forecast_value` per row, fires the `forecast_handoff` notification
  (`export/views_harvest_forecast.py:148`, `:291`). Partial failures still return 200 with `errors`.
- **Trucks**: `POST /api/v1/export/shipments/` with `is_draft: true`,
  `block_sources: [{block_id, weight_kg}]`, optional `export_code`
  (`export/views.py:1982` → `_create_draft_shipment` `:2087` → `write_block_sources`).
  Stored as `ShipmentBlockSource(shipment, block, weight_kg, harvest_date)`.
- **Remaining** = `max(0, forecast − Σ ShipmentBlockSource.weight_kg)` over
  non-cancelled shipments **whose `date` == D** (`export/services/harvest_forecast.py:20`).
- **Draw rules** (serializer pre-check `serializers.py:1840-1888`, locked re-check
  `assert_draw_within_pool` `harvest_forecast.py:147`):
  - each block row ≤ 18 500 kg;
  - a block with **no forecast that day is rejected**;
  - a row larger than that block's remaining is **rejected** — the pool cannot go negative.
  - The **full-truck (Σ = 18 500) rule is UI-only**, in `DraftComposerModal`
    (`:159`, `:229`). The backend accepts partial trucks.
- **Read endpoint**: `GET /api/v1/export/harvest-forecast/remaining/?date=` —
  **one date only**, returns `[{block_id, block_code, forecast_kg, allocated_kg, remaining_kg}]`.
- **Hooks**: `useHarvestForecastRemaining`, `useSubmitForecast`, `useCreateDraft`,
  `useCreateSupplyDraft`, `useJoinShipments` (`frontend/src/hooks/useDrafts.ts`).

### Two draft paths, and only one of them draws the pool

| path | UI | per-block kg | `skip_forecast_check` | reduces remaining? |
|---|---|---|---|---|
| forecast-first draft | `DraftComposerModal` (`/export/drafts`) | yes | false | **yes** |
| supply draft | `SupplyDraftModal`, Sheet "Ýük goş" | **null** | **true** | **no** |

Sera's Tır Aç carries per-block kg and is judged against Bakiye, so it is the
**first** path. A supply draft would leave Bakiye unchanged.

## 4. Mapping table

| sera concept | our equivalent | status |
|---|---|---|
| the "müdür" typing gaplama kg | `loading_dept_head` + deputy (tk: *Ýükleme gaplama bölüminiň müdiri*) | ✅ same person |
| `gaplamaHaftalikPlan[block][ymd]` | `HarvestDayEntry.forecast_value` | ✅ same meaning — the number trucks draw from |
| fallback to Önümçilik value when unset | show `plan_value` greyed when `forecast_value` is null | ✅ display-only, no write |
| grid cell editable any day, by anyone | loading head: **today + tomorrow only, until 12:00 on the day** | 🔴 **OPEN** — §5 Q1 |
| Tır Aç (export code + block/kg rows) | forecast-first draft with `block_sources` + `export_code` | ✅ endpoint exists |
| `isPartial` trucks allowed | backend allows; `DraftComposerModal` forbids | 🔴 **OPEN** — §5 Q2 |
| Export Kody generator `DDMMMNNN/YY` | **none** — `export_code` is free text (max 30); only `shipment_code` is generated | 🔴 **OPEN** — §5 Q3 |
| Tıra giden by `createdAt` day | Σ `ShipmentBlockSource.weight_kg` by **`shipment.date`** | ⚠️ different anchor; ours is better |
| Bakiye (may be negative) | `remaining_kg` (clamped ≥ 0; over-draw is **rejected**) | ⚠️ red-negative state cannot occur |
| 7-day Bakiye read | remaining endpoint is **single-date** | 🔴 backend gap — §6 |
| Tır sany, 2 decimals | `GreenhouseConfig.truck_capacity_kg` (global 18 500) | ✅ compute client-side |
| 🗑 remove truck | delete / cancel the draft (cancelled drafts leave the pool) | ✅ |
| rolling 7 days from today | ISO week everywhere else, incl. Önümçilik | 🔴 **OPEN** — §5 Q4 |
| grouped block chips | `BlockFilterSelect` (already on the branch) | ✅ reuse |
| per-crop truck kg | one global capacity | ⚠️ tomato only today; ignore |

## 5. The open questions — these change the build, so settle them first

### Q1. The grid is 7 days wide, but the owner of the grid may only write ~2 of them

Sera: all 7 columns editable, no window, no role check.
Ours: the loading head writes forecast from 00:00 the day before until 12:00 on the
day. On a normal morning that is **today (until noon) and tomorrow**; the other 5
columns are read-only for the one role this screen is for.

1. **Read grid with live columns** — 7 columns shown; only the cells
   `set_forecast_value` would accept are inputs, the rest read-only (plan greyed
   underneath). Zero new gates, same numbers as the drafts page. *Recommended.*
2. **Widen the window** — promote the hardcoded 12:00 / day-before to
   `GreenhouseConfig`. Changes `/export/drafts`, the daily board, the fallback
   view and the `forecast_handoff` timing too — it is a policy change, not a tab change.
3. **New storage** (`gaplama_value` or a `GaplamaDailyPlan` model) — sera-shaped and
   free to edit, but then drafts no longer draw from it, and Bakiye must be
   rebuilt from scratch. Throws away the reason this port is cheap.

### Q2. Partial trucks

Sera opens a truck with any kg and flags it partial; its Bakiye assumes partials
exist. Our backend accepts them; `DraftComposerModal` refuses to save below
18 500. The Gaplama form can allow partials (sera parity) or require a full truck
(drafts-page parity). Allowing them means `/export/drafts` and this tab disagree on
what a valid truck is.

### Q3. Which code does "Export Kody" fill?

Sera requires it and pre-fills `18SP001/26`. We have two codes:
`shipment_code` (auto, `DDMMNNN/YY`, server-generated) and `export_code` (free
text, no generator, becomes official later). Options: pre-fill `export_code` with a
new sera-format generator; leave `export_code` optional and rely on the
server-assigned `shipment_code`; or show `shipment_code` read-only after save.

### Q4. Rolling 7 days, or ISO week?

Inherited from Önümçilik (its note §6 Q3). Önümçilik on the branch already uses the
ISO week picker; a rolling Gaplama beside it would give two tabs whose JEMI
columns never agree. Day-grain reads work either way.

### Proposed defaults (2026-09-18, pending owner confirmation)

The owner could not settle Q1 yet. Each default below is the reversible choice.

| Q | default | why reversible |
|---|---|---|
| Q1 | **Keep the rule** — only cells `set_forecast_value` accepts are inputs; the rest read-only | widening the window later just unlocks more cells; no tab rewrite |
| Q2 | **Allow partial trucks**, tagged "partial" like sera | backend already accepts them; can add a 18 500 check to the form later |
| Q3 | **No new generator** — `export_code` optional (reuse `OfficialCodeEditor`), truck identified by server `shipment_code` | a generator can be added later without data changes |
| Q4 | **ISO week**, same picker as Önümçilik | display-only |
| gate | body `requires: 'export.plan'`, same as Önümçilik | one line in `TAB_BODIES` |

## 6. Build surface, if/when we proceed

**Backend — one gap.**
- `GET /export/harvest-forecast/remaining/` accepts optional `from_date` + `to_date`
  and returns the same rows plus `date`; `?date=` keeps today's behaviour exactly.
  One grouped query, not 7 calls. Same season resolution (`resolve_season()`).
- Nothing else. Writes reuse `POST /export/harvest-forecast/` and
  `POST /export/shipments/`.

**Frontend** — `frontend/src/pages/sera/GaplamaTab.tsx` (+ `.totals.ts` helpers,
tests), one `TAB_BODIES` entry in `TirTakip.tsx`, sera-styled CSS in `sera.css`,
`tir_takip.gaplama.*` i18n × tk/ru/en. Reuses `BlockFilterSelect`, `useDrafts`
hooks, `useDayEntries`.

**Read gate** — the tab code is granted to all 15 roles, so the body needs a
`requires` page code like the other tabs. `export.plan` (8 roles) is the natural
pick; this is an owner decision, not a guess.

## 7. Don'ts

- **Don't write through `upsert_daily_board`.** It sets `forecast_value` with no
  window and no role check (`greenhouse/services/daily_board.py:109-123`). Use
  `POST /export/harvest-forecast/`, which applies all four gate points.
- **Don't add a `tir_takip.gaplama.write` page code.** A Save on `/admin/permissions`
  from a server running `main` deletes every page row that is missing from main's
  `PAGE_REGISTRY`. It already wiped 150 `tir_takip` rows on 2026-09-16. The
  service-layer role + window checks are the durable enforcement.
- **Don't use the supply-draft path** (`useCreateSupplyDraft`) for Tır Aç. It sends
  `skip_forecast_check` with null per-block kg, so Bakiye would never move.
