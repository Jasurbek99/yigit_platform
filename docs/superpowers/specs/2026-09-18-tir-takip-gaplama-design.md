---
title: Tır Takip — Gaplama tab
date: 2026-09-18
branch: Copy_Gadams_UI
status: design approved in chat 2026-09-18 (revised after owner correction) — spec awaiting owner review
research: docs/TIR_TAKIP_GAPLAMA_VS_FORECAST_DRAFTS.md
---

# Tır Takip — Gaplama tab

## 1. Goal

Fill the `gaplama` placeholder tab of `/tir-takip` with a port of sera-butce-web's
Gaplama tab (`data/sera-butce-web/client/src/App.jsx` L13508–L14016).

**How the owner works** (correction, 2026-09-18). Each day the loading department
head opens packaging drafts (trucks) from the **Weekly Plan** of the blocks. One
draft can take kg from several blocks. The Gaplama grid is a copy of the plan that
**goes down** as drafts are opened, so the head sees what is still left to pack per
block and day. Nobody types kg into the grid.

| sera | platform |
|---|---|
| gaplama kg per block-day (falls back to the Önümçilik plan) | `HarvestDayEntry.plan_value`, read-only |
| Tır Aç (block/kg rows) | draft shipment with `ShipmentBlockSource(block, weight_kg)` |
| Tıra giden | Σ `ShipmentBlockSource.weight_kg` of non-cancelled shipments on that `date` |
| Bakiye | plan − Tıra giden |

The "copy" is **calculated, not stored**: remaining = current plan − opened drafts.
The Weekly Plan is never changed. When the plan is edited after drafts were opened,
the Gaplama numbers follow it (owner decision).

So this is **a view plus one read endpoint**. No model, no migration, no new page
code, no grid writes.

## 2. Decisions

All owner-approved 2026-09-18.

| # | decision |
|---|---|
| D1 | The grid shows **Weekly Plan** kg (`plan_value`). It is **read-only** for every role. |
| D2 | The Gaplama copy is **calculated** (plan − drafts), not stored. Plan edits flow through. |
| D3 | **Over-plan is allowed**, shown red, as in sera. The server does not block it. |
| D4 | **Partial trucks allowed**, tagged "partial" (Σ kg < `truck_capacity_kg`). |
| D5 | **No export-code generator.** `export_code` optional via `OfficialCodeEditor`; `shipment_code` left to the server. |
| D6 | **ISO week** (Mon–Sun), the same week navigation as Önümçilik. |
| D7 | Tab body `requires: 'export.plan'`; the endpoint checks the same pair server-side. |
| D8 | One new read endpoint for drafts in a date range; everything else reuses existing endpoints. |
| D9 | **No delete button.** Only admin can delete a draft (`hard-delete`); cancel is privileged-only. |

## 3. The screen

`frontend/src/pages/sera/GaplamaTab.tsx`, top to bottom.

**Header.** Title, `◀ Öňki hepde · Şu hepde · Indiki hepde ▶`, the ISO week's date
range, one caption line, and `BlockFilterSelect`, which is already on the branch and
groups blocks by Dusak / Kaka / Owadandepe.

**① Grid — blocks × Mon…Sun + JEMI.** Rows are every active top-level block
(`buildPlanGridRows`, as on Önümçilik), narrowed by the block filter. Each cell shows:
- **large:** remaining = plan − Tıra giden. Red when < 0. `—` when both are 0.
- **small, grey, underneath:** `plan N`, shown only when a draft has taken from that
  cell, so a fully untouched cell reads as the plan itself.

The JEMI column shows the week's remaining per block.

Footer rows:
1. **JEMI plan** — Σ plan per day.
2. **Tır sany** — JEMI plan ÷ `GreenhouseConfig.truck_capacity_kg`, 2 decimals, `—` when 0.
3. **📦 Açylan tırlar** — per day, one chip per draft (`shipment_code`, kg, `partial`
   tag); the JEMI cell shows the week's count.
4. **Galan (Bakiye)** — Σ remaining per day. Red when < 0.

**② Tır Aç form.** Collapsed by default into a `+ Tır Aç` button, shown when
`canDoBackendGated(user, 'shipment', 'create')` is true. That is the Sheet "+" button's
check, and both loading-head roles hold it on the live DB (verified 2026-09-18).
Opening it shows:
- **Day** — one of the browsed week's 7 days. It defaults to today when today is in
  that week, otherwise to the week's Monday.
- **Rows** — `[block ▾] [kg]` plus `✕`, and `+ Blok goş`. Each row shows that block's
  remaining kg for the chosen day, from the grid data.
- **Export kody** — optional, `OfficialCodeEditor`.
- **Jemi** — Σ kg, with a `partial` tag when below capacity.
- **[Tır Aç] [Ýatyr]** — submit is disabled when no row has kg > 0.

Submit uses the existing `useCreateDraft` and sends
`{is_draft: true, date, block_sources: [{block_id, weight_kg}], export_code?, skip_forecast_check: true}`
with **no** `shipment_code`.

`skip_forecast_check: true` is required. Without it, the server rejects any block that
has no forecast that day ("Submit a forecast before creating a draft") and caps each
block row at the forecast remaining. The flag skips both, but the block sources are
still written with their kg (`_create_draft_shipment`, `views.py:2087`; its docstring
says "the blocks still count toward allocated_kg for future checks").

Duplicate blocks are merged client-side, because `ShipmentBlockSource` is unique on
(shipment, block). The tab calls `mutate(payload, { onSuccess })` and invalidates
`['gaplama-trucks']` there. `useCreateDraft`'s own `onSuccess` does not, and the
shared hook stays unchanged.

**③ Haftalyk Özet.** Per block: Plan | Tıra giden | Galan, plus a JEMI row. Only blocks
with a plan or a draft that week are shown.

**④ Açylan tırlar.** Newest first: code (`shipment_code`, with `export_code` beside it
when set), blocks as `A (12 000 kg) + B (6 500 kg)`, kg, status, date. No delete.

Parts ③–④ render only when the week has at least one draft, as in sera. Sera's
separate "Blok Bakiyesi — Günlük" table is **dropped**: grid ① already shows remaining
per block per day, so the table would repeat it.

## 4. Backend — one endpoint

`GET /api/v1/export/harvest-forecast/trucks/?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD[&season=<id>]`

- **View:** `HarvestForecastTrucksView` in `export/views_harvest_forecast.py`; route in
  `export/urls.py` next to the two existing `harvest-forecast` paths.
- **Permission:** `CanViewTirGaplama` in `export/permissions.py`,
  `PAGE_CODES = ('tir_takip.gaplama', 'export.plan')`. It copies `CanViewTirHasabat`.
  Both codes already exist, so nothing is added to `PAGE_REGISTRY`.
- **Season:** resolved through `resolve_season()`:
  - an unknown id returns 404;
  - a closed season without `closed_season.can_view` returns 403;
  - during the gap the response is `[]`.
- **Window:**
  - both dates are required;
  - `from_date > to_date` returns 400;
  - a span over 31 days returns 400;
  - the window is **clamped to the season** (`max(from, start)`, `min(to, end)`), per
    the contract rule "a default window is not a bound".
- **Rows:** shipments with `date` in the window, `season` = the resolved season, status
  not `cancelled`, and at least one block source with non-null `weight_kg`. This is the
  same predicate `get_remaining_for_date` uses, so a draft opened here and one opened
  on `/export/drafts` count the same way everywhere. Sheet supply rows (null per-block
  kg) are excluded.
- **Query:** `select_related('status')`, `prefetch_related('block_sources__block')`,
  and `.order_by('-date', '-id')`. No N+1.
- **Response:** a flat array, bounded by the ≤31-day window like `remaining`, so no
  pagination:

```json
[
  {
    "id": 812,
    "shipment_code": "1809012/26",
    "export_code": null,
    "date": "2026-09-18",
    "status": 1,
    "status_code": "draft",
    "status_display": "Draft",
    "block_sources": [
      { "block_id": 5, "block_code": "F", "weight_kg": "12000.00" },
      { "block_id": 6, "block_code": "G", "weight_kg": "6500.00" }
    ]
  }
]
```

`weight_kg` is a **decimal string**. The hook converts it with `Number()` in its
`queryFn`. There is no `weight_net`: the truck's kg is Σ `block_sources`.

## 5. Frontend files

| file | what |
|---|---|
| `pages/sera/GaplamaTab.tsx` | the tab (§3) |
| `pages/sera/GaplamaTab.totals.ts` | pure math: Tıra giden per block-day (multi-block drafts split across rows), remaining, day/week JEMI, Tır sany, partial flag |
| `pages/sera/TirTakip.tsx` | one `TAB_BODIES` entry: `gaplama: { requires: 'export.plan', node: <GaplamaTab /> }` |
| `pages/sera/sera.css` | any new `.sera-*` classes, scoped under `.sera-page` |
| `hooks/useGaplama.ts` | `useGaplamaTrucks(from, to)`: the new endpoint, key `['gaplama-trucks', from, to]`, converts decimals |
| `types/index.ts` | `IGaplamaTruck`, `IGaplamaTruckSource`; `IDraftCreatePayload.shipment_code` made optional (safe to widen, because the server already treats it as optional) |
| `i18n/{tk,ru,en}.json` | `tir_takip.gaplama.*` |

Reused, not forked: `useDayEntries` (plan values), `useGreenhouseBlocks`,
`useGreenhouseConfig`, `buildPlanGridRows`, `useCreateDraft`, `BlockFilterSelect`,
`OfficialCodeEditor`, `useSeasonReadOnly`. On a closed or browsed-past season the
Tır Aç button is hidden, because the server would 409.

## 6. Testing

**Backend** — `apps/export/tests/test_harvest_forecast_trucks.py`:
- the window returns only trucks inside it; cancelled trucks and null-kg supply rows
  are excluded;
- a draft created with `skip_forecast_check` and block kg, with no forecast for that
  day, **is** returned. This is the Gaplama path;
- **parity**: Σ `weight_kg` per block for one date equals `get_remaining_for_date(...)`'s
  `allocated_kg` whenever a forecast exists;
- missing or inverted dates → 400; a span over 31 days → 400; the window is clamped to
  the season;
- unknown season → 404; closed season without permission → 403; the gap → `[]`;
- permission: 403 without `tir_takip.gaplama`, 403 without `export.plan`, 200 with both,
  and a superuser always passes;
- query count stays flat as trucks are added.

**Frontend** (vitest):
- `GaplamaTab.totals.test.ts`:
  - remaining = plan − drafts;
  - a multi-block draft is split across its block rows;
  - negative remaining (over-plan);
  - Tır sany rounding;
  - the partial flag;
  - a block with a draft but no plan shows negative.
- `GaplamaTab.test.tsx`:
  - the grid has no inputs for any role;
  - the Tır Aç payload carries `skip_forecast_check: true` and no `shipment_code`;
  - duplicate blocks are merged;
  - server errors show;
  - no Tır Aç button without `shipment.create` or on a read-only season;
  - after a successful submit, `['gaplama-trucks']` is invalidated.
- `TirTakip.test.tsx`: Gaplama renders the body with `export.plan` and the no-access
  panel without it.

## 7. Out of scope

Recorded here so nobody expects them:
- **Soft-deleted drafts still count.** The pool calculation excludes only `cancelled`,
  not `deleted_at`. This bug already exists and affects `/export/drafts` too. It is
  tracked separately, and this endpoint mirrors the current predicate on purpose.
- Typing or correcting kg in the Gaplama grid (D1). A frozen copy of the plan (D2).
- A sera-format export-code generator.
- Deleting drafts from this tab.
- A per-truck 18 500 kg cap. `skip_forecast_check` also skips the server's per-row cap,
  as in sera; the form only tags partials.
- Per-crop truck capacity; `truck_capacity_kg` stays global.
- Aktar / Ayyr — the Tırlar tab's Join already covers it.

## 8. Where and how it ships

- Branch **`Copy_Gadams_UI`**, built in its own git worktree. The `main` working tree
  holds other sessions' uncommitted work.
- Docs are updated with the code:
  - `docs/obsidian/screens/tir-takip.md` (5 of 9 tabs, a Gaplama section);
  - `docs/obsidian/reference/api-endpoint-map.md`;
  - the `api-contract` skill (the new endpoint);
  - `CHANGELOG.md`;
  - a `BUILD_TEST_LOG.md` entry.
- No commit without the owner's explicit "commit".

## 9. Risks

- **Gaplama drafts shrink the Drafts page pool.** A draft opened here has block kg, so
  `get_remaining_for_date` counts it as allocated on `/export/drafts` for that day. That
  is correct, because it is the same truck. It does mean the drafts page can show less
  forecast left than the forecaster expects, if the Gaplama draft was opened without a
  forecast in mind.
- **Plan edits move the numbers.** With the calculated copy (D2), editing the Weekly
  Plan or approving a plan-change request changes Gaplama's remaining immediately. It
  can turn a cell red after the fact.
- **No server-side over-plan guard.** Over-plan is intended (D3), and a typo such as
  180 000 instead of 18 000 would still be saved. The red cell is the only signal.
- **Permission wipe.** A Save on `/admin/permissions` from a server running `main`
  deletes the `tir_takip.*` rows, which hides this tab and 403s the endpoint for every
  non-superuser. This already exists, is not caused by this tab, and is fixed by
  re-seeding.
