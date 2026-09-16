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
> **One of nine tabs filled.** `onumcilik` renders the Weekly Plan grid (see
> [[#The Önümçilik tab]] below); the other eight are still placeholders. The owner
> is supplying the contents tab by tab, and each placeholder is replaced as its
> spec arrives.

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
│ │  (Önümçilik → the Weekly Plan grid; the other 8 → placeholder) │ │
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

The **season switcher is shown** here, like everywhere else. It was hidden on sera
routes while every tab was a placeholder — no season-scoped data meant the picker
offered a choice that changed nothing. That stopped being true the moment
`onumcilik` started rendering the Weekly Plan grid, which reads the selected
season: hiding the control would let someone browse a closed season on
`/export/plan`, open this tab, and find a read-only grid with the fix nowhere on
screen. `isSeraPage` still drives the header's gradient; it no longer drives the
switcher.

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

### Known cosmetic state

The tab is antd — white cards and antd controls — sitting inside the green sera
page, and it renders its own `Weekly Plan` heading under a tab already labelled
*Önümçilik*. Both are deliberate at this step: the restyle is the next piece of
work, and keeping the copy verbatim keeps that diff readable.

### Planned divergence

`docs/TIR_TAKIP_ONUMCILIK_VS_WEEKLY_PLAN.md` compares the sera original against
our grid. The four decisions that must be settled before any *functional* change:
what our equivalent of sera's export-bound daily kg is, where its
`Export+Gapy` reference number comes from (we have no per-month channel split),
whether the tab keeps ISO weeks or adopts sera's rolling 7-day window, and who may
write.

## Permissions

Ten codes: one container (`tir_takip`) plus one per tab. **All ten are granted to
all 15 roles** by `core/0051_tir_takip_page_perms` — the owner asked for the page
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
| Styles | `frontend/src/pages/sera/sera.css` |
| Tests | `frontend/src/pages/sera/TirTakip.test.tsx` (10 tests; `OnumcilikTab` mocked at the module boundary so the shell tests stay free of the Query/Router stack) |
| Comparison note | `docs/TIR_TAKIP_ONUMCILIK_VS_WEEKLY_PLAN.md` — the sera original vs our grid, and the four open decisions |
| Route | `frontend/src/App.tsx` — `tir-takip`, `pageCode="tir_takip"` |
| Nav | `frontend/src/components/AppLayout.tsx` — boss `group_shipping`, staff `group_export` |
| Header | `frontend/src/components/AppLayout.tsx` — `isSeraPage` toggles `.sera-header`. It no longer hides `<SeasonSwitcher />`: the Önümçilik grid is season-scoped |
| Route→code | `frontend/src/utils/permissions.ts` — `ROUTE_PAGE_MAP` |
| Codes | `backend/apps/core/permission_registry.py` |
| Defaults | `backend/apps/core/management/commands/seed_permissions.py` — `_TIR_TAKIP` |
| Migration | `backend/apps/core/migrations/0051_tir_takip_page_perms.py` |
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
