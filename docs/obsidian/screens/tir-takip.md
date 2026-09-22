---
title: Tır Takip (Maşyn Yzarlamasy)
tags: [screen, export, sera-design, tabs, permissions]
related: [[../processes/permissions-system]], [[permissions-admin]], [[../reference/api-endpoint-map]]
---

# Tır Takip (Maşyn Yzarlamasy)

Tab shell at `/tir-takip`. A port of the `TirTakipPage` tab bar from the separate
`data/sera-butce-web` app (`client/src/App.jsx:13360`), carrying **that app's visual
language rather than the platform's Ant Design theme** — owner request, 2026-09-16:
*"new pages have another design, don't change ours."*

> [!warning] Status as of 2026-09-16
> **Four of nine tabs filled.** `onumcilik` renders the Weekly Plan grid (see
> [[#The Önümçilik tab]]), `tirlar` renders the Shipment Sheet (see
> [[#The Tırlar tab]]), `hasabat` renders live report aggregates (see
> [[#The Hasabat tab]]) and `datalar` renders the Shipment Settings page (see
> [[#The Datalar tab]]); the other five are still placeholders. The owner is
> supplying the contents tab by tab, and each placeholder is replaced as its spec
> arrives.

## Page layout

```
┌────────────────────────────────────────────────────────────────┐
│ ░░ YGT / Maşyn Yzarlamasy        TM RU EN  🔔 ░░  ← app header │
├░░──────────────────────────────────────────────────────────────┤
│ ░░ same gradient, no seam, no season picker ░░                 │
│                                                                │
│  Önümçilik │ Gaplama │ Tırlar │ 📦 Export Raporu │ 📊 Hasabat  │
│  ──────────                                                    │
│  Gümrük Ewraklary │ Kwota Takibi │ Yurtdışı Sertnamaları │ …   │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │  Önümçilik → Weekly Plan grid · Tırlar → Shipment Sheet      │ │
│ │  (Tırlar has no card: the sheet fills the page edge to edge) │ │
│ │  Hasabat → report · Datalar → Shipment Settings              │ │
│ │  (the other 5 → placeholder)                                 │ │
│ └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

The page renders inside the normal `AppLayout`, so the platform sidebar stays
available. The **header takes the design too**: on a sera route `AppLayout` puts
`.sera-header` on its `<Header>` and drops the inline white background, so the bar
carries the identical gradient and the two surfaces read as one. Both pin it with
`background-size: 100vw 100vh` — without that they each resolve their own 135deg
ramp over a different height and the join shows as a step (measured: 1/255 per
channel with the pin, across the full width).

> [!caution] No season picker, and both filled tabs are season-scoped
> The season switcher was removed from the header **app-wide** on 2026-09-16 by
> owner request. It had first been hidden on sera routes only, on the grounds that
> they carried no season-scoped data — true while all nine tabs were placeholders,
> and false from the moment `onumcilik` started rendering the Weekly Plan grid,
> which resolves its season through `useSelectedSeason`.
>
> With no control anywhere, the grid falls back to the active season, which is the
> right answer almost always. The gap is `?season=<id>` in the URL: a bookmark or a
> shared link pins a different season, `useSeasonReadOnly` turns the grid read-only
> if that season is closed, and there is now nothing on screen to switch back —
> only editing the URL. Worth knowing before someone reports "the tab won't let me
> type". Restoring the control is two uncomments in `AppLayout.tsx`, marked there.
>
> The same applies to **Tırlar**: `useShipmentSheet` resolves its season through
> `useSelectedSeason` too, and `SheetGrid` goes read-only via `useSeasonReadOnly`.

## The nine tabs

| Tab key | Label (tk) | Page code |
|---|---|---|
| `onumcilik` | Önümçilik | `tir_takip.onumcilik` |
| `gaplama` | Gaplama | `tir_takip.gaplama` |
| `tirlar` | Tırlar | `tir_takip.tirlar` |
| `export_rapor` | 📦 Export Raporu | `tir_takip.export_rapor` |
| `hasabat` | 📊 Hasabat | `tir_takip.hasabat` |
| `gumruk_ewrak` | Gümrük Ewraklary | `tir_takip.gumruk_ewrak` |
| `kwota_takibi` | Kwota Takibi | `tir_takip.kwota_takibi` |
| `sertnamalar` | Yurtdışı Sertnamaları | `tir_takip.sertnamalar` |
| `datalar` | Datalar | `tir_takip.datalar` |

## The Önümçilik tab

`frontend/src/pages/sera/OnumcilikTab.tsx` — a **deliberate verbatim copy** of
`pages/export/WeeklyPlanGrid.tsx` (see [[../processes/weekly-harvest-planning]]).
The function name and two relative imports are the only edits; everything else is
byte-identical, so a diff between the two files reads as the sera restyle and
nothing else.

> [!note] Do not de-duplicate this back into a shared component
> These pages carry their own visual language by owner request, so this copy is
> about to be restyled away from antd while `/export/plan` stays exactly as it is.
> A shared component with a `variant` prop would put both designs in one file and
> make every future change to either one a risk to the other. The duplication is
> the cheaper half of that trade.

**Shared, not forked** — the `usePlanning` hooks, `HarvestCell`,
`CellHistoryModal`, `GrantExtensionModal`, `TruckAllocationTable`,
`WeeklyPlanGrid.roles` and the `plan.*` i18n keys. Those are logic and data, which
both designs agree on. Fork one only when the restyle actually reaches it.

Both screens read and write the same `HarvestDayEntry` rows — the duplication is
of the *view*, never of the data.

### Permissions — the tab is open, the data is not

**Writes** need nothing new. The grid brings its own gates along with the copy,
all enforced in `greenhouse/services`: role, block ownership via
`BlockManagerAssignment`, and the plan-week cutoff. A role that can open the tab
but may not edit plans gets a **read-only grid**, not an editable one. That holds
for as long as the tab renders our grid; it stops holding the moment the tab gets
its own editable cells writing through a new endpoint, which would need its own
write code (e.g. `tir_takip.onumcilik.write`). See
`docs/TIR_TAKIP_ONUMCILIK_VS_WEEKLY_PLAN.md` §6 Q4.

**Reads** needed a second gate, and this is the part that is easy to get wrong.
`tir_takip.onumcilik` is granted to **all 15 roles**; `export.plan` is granted to
**8** (admin, boss, director, document_team, export_manager, greenhouse_manager,
loading_dept_head, loading_dept_head_deputy). Rendering the grid behind the tab
code alone would have handed the other seven — accountant, finansist, sales_rep,
seller, transport, warehouse_chief, weight_master — every block's
planned/forecast/actual kg, the block-manager names and the late-edit state, none
of which they can reach on `/export/plan`.

`TAB_BODIES` therefore carries an optional `requires` code checked **on top of**
the tab's own: `onumcilik: { requires: 'export.plan', … }`. The tab stays visible
to everyone (what the owner asked for); a role without `export.plan` sees
`tir_takip.tab_no_access` in the panel instead of the grid. Granting it is still
an admin's checkbox, not a deploy.

> [!important] The rule this encodes
> Copying a screen must not widen who can read it. Any future tab that renders a
> view of data with a home elsewhere in the platform gets that page's code in
> `requires`, not a fresh code of its own.

### The restyle (step 2)

The table wears sera's typography and palette, ported from `App.jsx:13412–13500`.
It is still an antd `<Table>`: that component already carries the sticky first
column, the horizontal scroll, the summary row and the editable cell, and none of
those change. So `sera.css` holds antd's DOM in sera's clothes rather than a
reimplementation of the markup.

| | sera value |
|---|---|
| table base | 12px, headers weight 500 |
| number input | 14px — the one thing sera sets *larger* than the table, because it is what gets typed |
| header | bg `#fafaf9`, text `#a8a29e` |
| block name | `#44403c` |
| totals | `#047857`, weight 600 |
| total row | bg `#ecfdf5`, text `#065f46`, weight 700 |
| borders | `#e7e5e4` header · `#f5f5f4` between cells · `#d6d3d1` before the total column |
| today column | header `#fef3c7`, body amber-50 at 40% |

Every selector starts at `.sera-page`, so `/export/plan` — the same grid one route
away — is untouched.

**Texts stay ours** — our weekday names, our block labels, our `plan.total`.
Sera's *"şu gün"* caption under today's date does come across, but through a new
`plan.today` key, so it reads "Today" / "Şu gün" / "Сегодня" with the rest of the
interface rather than being Turkmen on an English screen.

**The block-code tag is gone from the Block column** (owner request): the name
identifies the row. That tag also carried the gold/blue "one of my blocks" marker
for a block manager; the signal survives on the row, which keeps its yellow
background and inset gold left bar.

**Cell height is measured, not guessed.** Sera's box is 34px — `py-1.5` is 6px top
and bottom, `text-sm` is a 20px line, plus 1px of border each side. antd's `small`
input is 24px, which is why the first pass read short. The read-only cell is given
36px (34 + the border) so a cell nobody can edit does not make its row shorter
than the editable rows beside it.

### The cell

`OnumcilikCell.tsx` replaces `HarvestCell` on this tab — the first fork the
restyle has actually needed, and the one the note above always said would come.

Sera's cell (`NumInput`, `App.jsx:2300`, used at `App.jsx:13438`) is a bordered
box you type straight into. `HarvestCell` is click-to-edit and, for an admin on
today's or a past day, stacks **two** values: the actual (large) over a small
`Plan: …` line. Sera's holds exactly one number, so matching it forced a choice
about which. It is the **plan** — this is a planning grid, and both
`greenhouse_manager` and `boss` already saw plan-only here.

> [!warning] What this removes, for `admin` and `director`, on this tab only
> Overriding an `actual_value` from inside a cell, and the rollup/override source
> badge. `/export/plan` still renders `HarvestCell` and keeps both, and the
> backend is untouched — the capability is absent from this screen, not gone.
> Owner decision, 2026-09-16: *"Actual don't need, remove it"*.

What the fork keeps, because dropping it would break writes rather than looks:

- **The admin reason gate.** Overwriting a value that was already there opens
  `AdminOverrideReasonModal` first. The backend rejects an admin-like write with
  no reason, so saving straight through would 400. Filling an *empty* cell is an
  entry, not an override, and saves directly.
- **Read-only as plain text**, never a disabled box. Sera has no read-only state
  to copy because it has no permissions; an input nobody can use would promise an
  edit the backend would refuse. Clicking it opens the history modal.
- **The explicit-zero distinction** — `0 ✓` in italic when `plan_submitted_at` is
  set, an em-dash when the value is NULL.

The pivoted (transposed) view uses the same cell. A pivot toggle changes which
axis is which, not what a cell means; leaving `HarvestCell` there would have made
the actual reachable through a button meant only to rotate the table.

`planOnlyCells` and `canEditActual` are consequently no longer read on this tab —
every cell is plan-only by construction, so neither has a branch left to select.
Both still drive `/export/plan`.

### The header tiles

The **Late submissions** tile is gone (owner request). `plan_state` is unaffected:
the backend still records `on_time`/`late`/`critical_late`, the dispatcher still
notifies, and the tile still exists on `/export/plan`, where chasing late block
managers is the job. This tab is for reading the week's tonnage.

### The Total column

`JEMI` in the sera app. Last column, not sticky, heavier `#d6d3d1` rule on its
left. It sums **one block's visible week** — hiding Sunday narrows the total with
it, so the figure always equals the columns a reader can add up by eye. The corner
cell where it meets the total row is summed by the same function, so the two can
never disagree.

It shows **plan only**, because the day-total row it terminates shows plan only —
that row's actual line is commented out. A row total carrying a second figure the
column below it does not show would read as a discrepancy, not as extra
information.

The arithmetic lives in `OnumcilikTab.totals.ts` (`sumBlockWeek`, `sumAllBlocks`)
rather than inline in the column renderer: the grid needs the Query and Router
stacks to render at all, so a pure module is the only part of this that can be
tested without standing up both.

### Every block, every week (create-on-write)

The grid's rows come from the **block list**, not the plan list —
`buildPlanGridRows(useGreenhouseBlocks(), plans)`, shared with `/export/plan`. A
week nobody has touched shows every active top-level block with empty inputs;
the first value typed goes to `POST /greenhouse/day-entries/write-cell/`, which
creates the week's rows and then applies the same gates a PATCH would. There is
no Initialize Week button any more. Full model, and why a refused write leaves no
rows behind: [[../processes/weekly-harvest-planning]].

A missing day is an `OnumcilikCell` with `entry={null}` plus `block` and
`entryDate`. An editor gets an empty box, and an admin filling it gets no reason
modal, since nothing is being overwritten. A non-editor gets an em-dash with no
click handler, because there is no row whose history could open.

### Toolbar, Sunday, block filter

- **Week controls** sit at the right-hand end of the toolbar: the week picker,
  then **◀ Previous week · This week · Next week ▶** in sera's style. «This week»
  is highlighted only on the actual current ISO week. The default view jumps to
  next week after Thursday, so "no offset" is not the same test.
- **Generate plan tasks is not on this tab.** It remains on `/export/plan`.
- **Sunday** is a small **+** in the header of the last day column, i.e. just left
  of Total, which becomes **−** once Sunday is showing. An accidental click is one
  click to undo. The pivot view has no day header, so it carries the same control
  beside its last day's row label.
- **Block filter** — an antd multi-select grouped by `location_name` (Dusak /
  Kaka / Owadandepe; a block with no location goes in a last group). `null` means
  "no filter"; clearing returns to `null`, never to an empty table. Options are
  built from all rows, so a filtered-out block can be picked again. The Total
  column and the total row follow the filter. The **Total Plan** header tile does
  not, because it also feeds the truck estimate.
- **Block column** shows the location, small and muted, between the block name
  and the manager names; nothing is shown for a block with no location.

### Known cosmetic state

The tab still renders its own `Weekly Plan` heading under a tab already labelled
*Önümçilik* — a duplicate title, kept pending the owner's call. The header tiles,
buttons and the truck-allocation table below the grid are still antd-default; only
the grid itself has been restyled so far.

### Planned divergence

`docs/TIR_TAKIP_ONUMCILIK_VS_WEEKLY_PLAN.md` compares the sera original against
our grid. The four decisions that must be settled before any *functional* change:
what our equivalent of sera's export-bound daily kg is, where its
`Export+Gapy` reference number comes from (we have no per-month channel split),
whether the tab keeps ISO weeks or adopts sera's rolling 7-day window, and who may
write.

## The Tırlar tab

`frontend/src/pages/sera/TirlarTab.tsx` — the trucks sheet. A copy of
`pages/export/ShipmentSheet.tsx`, **the page wrapper only**. `SheetGrid` and every
component beneath it are reused untouched.

### Why there is no grid restyle

The Sheet already ships this screen. Its **`ios` design variant is a reproduction
of sera's `Tır Takip → Tırlar`** (`App.jsx:14018`) — see the header of
`components/sheet/sheetTopicOrder.ts`. That module orders rows into sera's topic
sections (Genel Bilgiler · Ýük & Gümrük · Transport · Ýükleme Zamanlary · Ýolda ·
Satyş & Hasabat) instead of the classic per-owner role bands, and
`SheetVariantIos.css` is the skin. Sera's table and ours were already the same
shape: transposed, one truck per column, a frozen label column on the left.

So the tab **pins `variant="ios"`** and adds no grid CSS. Any user can already see
this look on `/export/shipments/sheet` by switching the toolbar's design toggle to
iOS.

> [!warning] Why no grid CSS at all
> The grid is virtualised (`@tanstack/react-virtual`). A width or row height set
> in CSS that the virtualizer has not measured makes the frozen header drift out of
> line with the body while scrolling — silently; tests and `tsc` stay green. The
> only rule `sera.css` adds is `.sera-sheet`, a height context (below).

### Pinned by prop, not by store

`SheetGrid` gained one optional prop, `variant?: TSheetVariant`, which wins over
the store when present. Omitted everywhere else, so `/export/shipments/sheet`
renders exactly as before.

`SheetGrid` forwards the pin to **`SheetCell`**, which takes the same optional
prop. The cell has to have it: the variant sets the shipment column width and the
row height (`scaleSheetLayout` — `ios` is rows ×1.35, columns ×1.15), and the cell
reads them itself. A pinned grid with store-sized cells lays its slots out for
`ios` and paints `classic`-sized cells inside them — misaligned, and invisible to
any test that mocks the grid. `SheetCell.variantPin.test.tsx` covers it (fails
against the unpinned cell).

What is forwarded is the **caller's pin, not the resolved variant**. `renderCell`
is a `useCallback` whose deps have never listed `sheetVariant` (a pre-existing
lint warning), so a resolved value would go stale — and, as a prop, would then
override the store and stop the Sheet's own toggle resizing cells. The pin is
`undefined` on the Sheet route, so the cell keeps reading the live store there.

`SheetLabelColumn` also reads the variant from the store and was left alone:
`scaleSheetLayout` does not scale the label columns by variant, so there is
nothing for it to get wrong.

It is a prop because the store route leaks: `setSheetVariant` writes
`ygt-sheet-variant` to `localStorage`, so pinning through it would send the user
back to the classic Sheet still wearing this skin.

### What the copy drops

Each is page-level chrome that misbehaves inside a tab panel:

| Dropped | Why |
|---|---|
| `usePresenceSheet()` | Joins the `presence.sheet` room — from a second location the roster stops meaning "who is on the Sheet" |
| `?shipment=` / `?row=` / `?comment=` / `?code=` effects | They address the Sheet route and would fire on `/tir-takip` URLs |
| Fullscreen, zoom, `sheet-page page-fullheight-grid` | That pair pins the grid to the viewport by stripping `<Content>`'s padding — wrong inside a card |
| `SheetToolbar` | Search, filters and the classic/iOS toggle. The toggle inside a sera page reintroduces the leak above |
| `groupRowsByOwner` | The classic variant's grouping; the grid re-groups by topic in `ios` anyway |

**No filtering**, as a consequence of dropping the toolbar. `searchText` and
`sheetFilters` are not persisted, but they live in a module-level store that
survives client-side navigation. Applying them here would let a search typed on
the Sheet hide trucks in a tab with no filter UI to clear it, so the tab passes
every shipment straight to the grid. Sera's own filters (year, month, block,
status — `App.jsx:14020`) are a separate piece of work: its filter model is not
this store's.

**Kept:** `useSheetLiveSync` (refetch on others' writes), the comments drawer, the
row-hide control, and `setRows` — `CommentItem` and `MentionPopover` read the row
map from the store.

### No card, full page

Every other tab body sits in the bordered `.sera-card`. On Tırlar that read as a
small window inside the page (owner, 2026-09-16), so the panel loses its chrome
there — no border, radius, shadow, background or padding — via
`.sera-card:has(> .sera-sheet)`. The sheet runs **edge to edge** under the tab
strip, like the Sheet's own route: `margin: 0 -24px -24px` takes it out through
the page's side and bottom padding.

**Height.** `.sheet-grid` is `flex: 1; min-height: 0` and scrolls inside its
parent, so every box above it needs a definite height — otherwise the grid
resolves to **zero height and the tab renders blank**. `<Content>` is already fixed
at `100vh - 56px` in `AppLayout`, so `.sera-page:has(.sera-sheet)` takes
`calc(100% + 24px)` of it and becomes a flex column; the panel and `.sera-sheet`
are `flex: 1; min-height: 0` inside it. No pixel constant for the tab strip — it
wraps to two lines on a narrow window and the sheet just gets less.

With `<ClosedSeasonBanner />` above the page, the page is pushed down by the
banner's height and `<Content>` scrolls by that much. Closed-season browsing only.

### Permissions

`TAB_BODIES` carries `tirlar: { requires: 'export.shipments_sheet', … }` — the rule
from the Önümçilik section applied again. `tir_takip.tirlar` is open to all 15
roles; the Sheet is not, and the tab would otherwise hand every role every truck's
customer, firm splits, driver and document state.

Cell-level rules are **unchanged and unforked**: `isCellEditable`, row access
grants and the backend field checks all come along with the reused `SheetGrid`.
Nothing in the permission chain was touched, so
`TestEveryRoleCanEditItsOwnSheetRow` was not in play.

### Shared state with the Sheet

`ygt-sheet-ios-order` (the per-browser topic row order), `ygt-sheet-freeze-v3`,
zoom and the comments drawer state are shared with `/export/shipments/sheet`'s iOS
variant. That is intended — it is the same view of the same rows.

## The Hasabat tab

`frontend/src/pages/sera/HasabatTab.tsx` — the source's "📊 Hasabat" tab
(`App.jsx:15319–15584`), fed by **live aggregates from the database** instead of
the browser-side truck list the source groups. Layout, panel order, icons and the
donut side legends (swatch · name · %) are the source's; the charts are the
platform's ECharts style (`CHART_PALETTE`, the `TeamRankingChart` axis treatment).
Owner request, 2026-09-16: *"use our chart style, but his text beside the charts."*

**Panels:** 5 KPI cards (Jemi tır · Jemi kg · Ortaça kg/tır · Açyk tırlar · Baran
tırlar), then kg+trucks by month, country and export-firm donuts, customer and
block horizontal bars, and four ranking tables (country, firm, customer, variety).
A panel with no rows is not rendered; zero trucks shows the source's hint.

**Data:** `GET /api/v1/export/tir-hasabat/[?season=<id>]` →
`backend/apps/export/services/tir_hasabat.py`, 60 s cache per season.

| Figure | Source |
|---|---|
| Which trucks | `Shipment.season` = resolved season, minus `draft`, `cancelled`, soft-deleted, archived — stated under the KPI row |
| Jemi kg, month/country/customer/variety kg | `Sum(weight_net)` — same as the Clients Report |
| Export-firm kg | `Sum(ShipmentFirmSplit.weight_kg)`; name `name_short`, else `code` |
| Block kg | `Sum(ShipmentBlockSource.weight_kg)` (nullable weights count 0, the truck still counts) |
| Month bucket | `TruncMonth(Shipment.date)` — not the source's loading time, which is nullable |
| Açyk / Baran | `status.step_order` < 9 / ≥ 9 (`bardy` = Arrived) |

> [!warning] The panel totals differ on purpose
> Firm and block kg come from their own tables, so they do not add up to Jemi kg.
> Every grouping ships its own `total_kg`, and every % on the tab is taken against
> **its panel's** total. The source divides every panel by the headline total — a
> faithful copy would show firm shares that never sum to 100.
>
> **Nor does Jemi tır match the Clients Report for the same season.** Hasabat
> scopes on the `season` FK and drops drafts / cancelled / deleted / archived;
> `clients_report.py` scopes on the season's date window and drops none of them.

Deliberate departures from the source: the month chart is **one kg bar per month,
labelled with kg and truck count** ("100K · 1 tır") — the source draws trucks as a
second bar on the kg scale, where they never leave the baseline, and a second
right-hand scale (tried first) made one truck's bar as tall as 100 000 kg, which the
owner read as the same quantity. Horizontal bar charts size to their row count
instead of a fixed 220 px. Card values stay in the source's short form (118K) by
owner choice; the exact kg is in the card's hover title.

### Permissions

Same rule as Önümçilik and Tırlar: the body needs a second code. Hasabat shows kg
per customer, export firm and country — the Clients Report's data — so it requires
**`analytics.clients`** (5 roles: admin, boss, director, document_team,
export_manager) on top of `tir_takip.hasabat` (all 15). Unlike the other two
bodies, which reuse endpoints that already gate themselves, this endpoint is new,
so the pair is enforced **server-side too** (`CanViewTirHasabat` in
`export/permissions.py`, superuser bypass): a role missing either code gets 403.

Consequence for admins: granting a role Hasabat's numbers means granting
`analytics.clients`, which also opens the `/analytics/clients` page and its nav
item for that role. There is no Hasabat-only switch.

## The Datalar tab

The source's Datalar tab is its reference-data table: the values the Tırlar
dropdowns offer. Ours already has a home for that, so the tab mounts
`pages/admin/ShipmentSettingsPage.tsx` **unchanged**: Statuses, Border Points,
Option Lists, Truck Splits, Sheet Rows and, for roles that can edit
`sheet_row_setting`, Row Access. No copy, no fork, and no edit to the admin page.
Mounting it as-is keeps its inner `canDo` write gates (`shipment`,
`truck_split_default`, `sheet_row_setting`) the admin page's own, so a seventh
sub-tab added there shows up here too. The six sub-tabs use no router hooks, so
none of the deep-link trouble Tırlar had to drop applies.

The page keeps its own "Shipment Settings" title inside the tab. Tables pick up
the sera look from the data-table block in `sera.css`; the nested antd `<Tabs>`
strip gets the sera accent from one block scoped to the tab's `.sera-settings`
wrapper (the Sheet's comment composer also renders antd `<Tabs>`). Buttons,
switches and links inside it are still antd blue.

The page is **lazy-loaded** with its own `<Suspense>`, as `App.tsx` does for the
route. Most roles only see the no-access panel, so they never download it.
Once opened, it passes `destroyInactiveTabPane={false}`, so all six sub-tabs stay
mounted until the user leaves Tır Takip. Their queries share the TanStack cache
with `/admin/shipment-settings`, with the same data and the same keys.

### Permissions

Same rule as the other three bodies, with more at stake: this body **writes**.
It edits statuses, dropdown options, truck-split defaults and Sheet row access,
which the Sheet permission chain reads from. It requires
**`admin.shipment_settings`** on top of `tir_takip.datalar`. By seed default that
is 4 roles (admin, boss, export_manager, document_team) against all 15 for the
tab code, so most roles see a Data tab that says *no access*. If that is unwanted,
revoke `tir_takip.datalar` for those roles in [[permissions-admin]]. The backend
needs no change, because every settings endpoint already gates its own writes.
Statuses, border points and option lists use the `REFERENCE_DATA_WRITE` role list
(`core/roles.py`). Truck splits and sheet rows use `DynamicResourcePermission`
(`truck_split_default`, `sheet_row_setting`).

## Permissions

Ten codes: one container (`tir_takip`) plus one per tab. **All ten are granted to
all 15 roles** by `core/0052_tir_takip_page_perms` — the owner asked for the page
to be open to everyone *and* configurable, so access is matrix rows rather than a
hardcoded list, and the first revoke is an admin's checkbox in
[[permissions-admin]] instead of a deploy.

The tab codes are **nested**, against the "flat codes on purpose" note on
`export.shipments_sheet` in `permission_registry.py`. The exception holds because
`tir_takip` renders no content of its own: `canSeePage` grants a parent whenever
any child is visible, and *"the page is reachable if at least one of its tabs is"*
is exactly the wanted semantics. The known cost — unchecking the container while a
tab stays checked does nothing — is honest for a pure container.

Two consequences worth knowing:

- Revoking a single tab never costs the user the whole page; the route guard uses
  the container code, which any surviving tab keeps alive.
- Container granted directly + all nine tabs revoked is a **real reachable state**.
  The page then renders an explicit empty state, not a blank shell.

## Files

| Role | Path |
|---|---|
| Page | `frontend/src/pages/sera/TirTakip.tsx` — tab strip + `TAB_BODIES` map |
| Önümçilik body | `frontend/src/pages/sera/OnumcilikTab.tsx` — verbatim copy of `pages/export/WeeklyPlanGrid.tsx` |
| Tırlar body | `frontend/src/pages/sera/TirlarTab.tsx` + `.test.tsx` (5 tests) — copy of the `pages/export/ShipmentSheet.tsx` wrapper; renders `SheetGrid` with `variant="ios"` |
| Sheet grid | `frontend/src/components/sheet/SheetGrid.tsx` — optional `variant` prop, forwarded to the cell |
| Sheet cell | `frontend/src/components/sheet/SheetCell.tsx` — same optional prop; `SheetCell.variantPin.test.tsx` (3 tests). With `SheetGrid`, the only edits to shared Sheet code |
| Styles | `frontend/src/pages/sera/sera.css` |
| Hasabat body | `frontend/src/pages/sera/HasabatTab.tsx` + `.test.tsx` (7 tests); chart builders `HasabatTab.charts.ts` + `.test.ts` (6 tests); hook `frontend/src/hooks/useTirHasabat.ts` |
| Hasabat endpoint | `backend/apps/export/views_tir_hasabat.py`, `services/tir_hasabat.py`, `permissions.py` (`CanViewTirHasabat`); tests `tests_tir_hasabat.py` (14) |
| Chart palette | `frontend/src/constants/styles.ts` — `CHART_PALETTE`, shared with the Clients Report |
| Cell | `frontend/src/pages/sera/OnumcilikCell.tsx` + `.test.tsx` (10 tests) — the always-visible sera input; replaces `HarvestCell` on this tab |
| Totals | `frontend/src/pages/sera/OnumcilikTab.totals.ts` + `.test.ts` (6 tests) — the Total column's arithmetic, kept pure so it is testable without the Query/Router stack |
| Datalar body | `frontend/src/pages/admin/ShipmentSettingsPage.tsx` — mounted as-is (lazy), no copy |
| Tests | `frontend/src/pages/sera/TirTakip.test.tsx` (16 tests; every tab body, `ShipmentSettingsPage` included, is mocked at the module boundary so the shell tests stay free of the Query/Router stack) |
| Comparison note | `docs/TIR_TAKIP_ONUMCILIK_VS_WEEKLY_PLAN.md` — the sera original vs our grid, and the four open decisions |
| Route | `frontend/src/App.tsx` — `tir-takip`, `pageCode="tir_takip"` |
| Nav | `frontend/src/components/AppLayout.tsx` — boss `group_shipping`, staff `group_export` |
| Header | `frontend/src/components/AppLayout.tsx` — `isSeraPage` toggles `.sera-header`. It no longer hides `<SeasonSwitcher />`: the Önümçilik grid is season-scoped |
| Route→code | `frontend/src/utils/permissions.ts` — `ROUTE_PAGE_MAP` |
| Codes | `backend/apps/core/permission_registry.py` |
| Defaults | `backend/apps/core/management/commands/seed_permissions.py` — `_TIR_TAKIP` |
| Migration | `backend/apps/core/migrations/0052_tir_takip_page_perms.py` |
| i18n | `frontend/src/i18n/{tk,en,ru}.json` — `tir_takip.*` (incl. `tab_no_access`), `nav.tir_takip` |

## Design containment

`sera.css` is the first stylesheet in the frontend that is not antd-aligned, so it
carries explicit containment rules (see the file header). The short version:

1. Custom properties on `.sera-page`, never `:root`.
2. Every selector is scoped to one of two opt-in classes, `.sera-page` or
   `.sera-header`. That is what makes it safe for `AppLayout` to import the
   stylesheet directly — the rules reach nothing that has not asked for them,
   and importing it there (rather than only from the lazy page chunk) is what
   stops the header flashing white while that chunk loads.
3. The gradient is painted by a positioned `::before` that reaches up through
   `<Content>`'s 24px top padding — nothing touches `body` or `index.css`. It
   must **not** use `z-index: -1`: a negative-z-index descendant paints below
   the in-flow backgrounds of intermediate ancestors, and `<Content>`'s grey
   would cover it completely. The layer stops at its own top edge when
   `<ClosedSeasonBanner />` is present (`:not(:first-child)`), which would
   otherwise lose 8px off that warning (it carries `marginBottom: 16`).
4. The global `<ConfigProvider>` theme is untouched.
5. The tab strip is hand-rolled, not antd `<Tabs>` — matching the underline
   treatment would need antd token overrides, and those bleed.

## Open decision

Whether a tab eventually stays a tab or becomes its own route is **still open, and
costs nothing to defer**: `tir_takip.gaplama` gates the tab today and would be that
route's `pageCode` unchanged tomorrow.
