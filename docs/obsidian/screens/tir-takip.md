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
> The shell only. All nine tab bodies are placeholders — the owner is supplying
> the contents tab by tab. Each placeholder is replaced as its spec arrives.

## Page layout

```
┌────────────────────────────────────────────────────────────────┐
│ ░░ green gradient fills the whole content area ░░              │
│                                                                │
│  Önümçilik │ Gaplama │ Tırlar │ 📦 Export Raporu │ 📊 Hasabat  │
│  ──────────                                                    │
│  Gümrük Ewraklary │ Kwota Takibi │ Yurtdışı Sertnamaları │ …   │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │  (tab body — placeholder until the owner supplies content) │ │
│ └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

The page renders inside the normal `AppLayout`, so the platform sidebar and header
stay available. Only the content area takes the sera design.

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
| Page | `frontend/src/pages/sera/TirTakip.tsx` |
| Styles | `frontend/src/pages/sera/sera.css` |
| Tests | `frontend/src/pages/sera/TirTakip.test.tsx` (7 tests) |
| Route | `frontend/src/App.tsx` — `tir-takip`, `pageCode="tir_takip"` |
| Nav | `frontend/src/components/AppLayout.tsx` — boss `group_shipping`, staff `group_export` |
| Route→code | `frontend/src/utils/permissions.ts` — `ROUTE_PAGE_MAP` |
| Codes | `backend/apps/core/permission_registry.py` |
| Defaults | `backend/apps/core/management/commands/seed_permissions.py` — `_TIR_TAKIP` |
| Migration | `backend/apps/core/migrations/0051_tir_takip_page_perms.py` |
| i18n | `frontend/src/i18n/{tk,en,ru}.json` — `tir_takip.*`, `nav.tir_takip` |

## Design containment

`sera.css` is the first stylesheet in the frontend that is not antd-aligned, so it
carries explicit containment rules (see the file header). The short version:

1. Custom properties on `.sera-page`, never `:root`.
2. Every selector is a descendant of `.sera-page`.
3. The gradient is painted on the page's own root div, which bleeds past
   `<Content>`'s 24px padding and re-applies it — nothing touches `body` or
   `index.css`.
4. The global `<ConfigProvider>` theme is untouched.
5. The tab strip is hand-rolled, not antd `<Tabs>` — matching the underline
   treatment would need antd token overrides, and those bleed.

## Open decision

Whether a tab eventually stays a tab or becomes its own route is **still open, and
costs nothing to defer**: `tir_takip.gaplama` gates the tab today and would be that
route's `pageCode` unchanged tomorrow.
