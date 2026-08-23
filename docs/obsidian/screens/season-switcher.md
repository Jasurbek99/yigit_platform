---
title: Season Switcher & Read-Only Mode
tags: [screen, component, frontend, season, ad-16]
related: [[../processes/permissions-system]], [[../reference/data-model-map]], [[../reference/api-endpoint-map]]
---

# Season Switcher & Read-Only Mode

## What Is This?

The frontend surface of AD-16 (season lifecycle, `docs/ADR.md`). Three pieces, all in
`AppLayout` above `<Outlet/>` (mounted once, app-wide):

1. **`SeasonSwitcher`** — a header `Select` next to the locale switcher, letting a permitted
   user browse a different season than the active (write-target) one.
2. **`ClosedSeasonBanner`** — a persistent `Alert` shown whenever nothing is currently
   writable, either because the browsed season is closed or because there is no active
   season at all (the close→open gap).
3. **`useSeasonReadOnly()`** — the boolean every disabled control in the app reads.

Plus the admin side: **Close / Open** actions on `SeasonsPage` (`/admin/seasons`), the only
place a human triggers `close_season()`/`open_season()`.

## Season selection — store, URL, precedence

`useSeasonStore` (Zustand, `frontend/src/stores/seasonStore.ts`) holds `selectedSeasonId` —
cross-component UI state, not server data, per `frontend/CLAUDE.md`'s table.

`frontend/src/hooks/useSeasonParam.ts` exports three hooks:

| Hook | Mounts | Purpose |
|---|---|---|
| `useSeasonParam()` | Exactly once, `AppLayout.tsx` | Owns the two `?season=` ⇄ store sync `useEffect`s |
| `useSelectedSeason()` | Every season-scoped query hook (~26 call sites) | Reads `{seasonId, isReady}` **synchronously**, no effects — `URL ?? store ?? user.active_season.id` |
| `useSwitchSeason()` | `SeasonSwitcher.onChange`, `ClosedSeasonBanner`'s back-button | Updates store + URL together in one handler, so a switch never leaves a stale `?season=` for a render |

`isReady` gates a query's `enabled` — it means "auth has resolved" (`!isLoading`), **not**
`seasonId !== null`. During the close→open gap `seasonId` is legitimately `null` forever;
gating on non-null would perma-disable every query and show a spinner instead of the
backend's fail-closed empty state (D7).

### Deleted season — `useSeasonFallback()`

`frontend/src/hooks/useSeasonFallback.ts`, mounted **exactly once** in `AppLayout.tsx`
beside `useSeasonParam()`. None of the three hooks above validate the id, so a
`?season=<deleted id>` — a bookmark or an open tab that outlived the row — reaches
`resolve_season()`, which raises `NotFound` and **404s every season-scoped query on the
page at once**. Refreshing does not help: the store→URL effect sees the dead id as "not the
default" and writes it back into `?season=` on every load, so the broken state reproduces
itself. Before this hook the only escapes were editing the address bar by hand or using the
switcher — which hides itself when fewer than two seasons are selectable.

When the `['admin-seasons']` list has **settled** (`isSuccess && !isFetching`) and the
selected id is absent from it, the hook calls `useSwitchSeason(activeSeasonId)` and toasts
`season.stale_season_reset`. Four deliberate inert cases:

- **list still fetching** — a season the user just created is legitimately absent from a
  stale cache (`staleTime` 60s); switching away would look like the create failed;
- **list unreadable** (roles without `season.can_view`) — a missing id cannot be told apart
  from one this role may not list, and guessing is worse than the 404;
- **no active season** (the D7 gap) — nothing to fall back to;
- **already on the active season** — also the loop guard, should the active season itself
  ever be missing from the list.

**Every dep of that effect must be stable across a render that changes nothing it reads.**
`useSwitchSeason()` writes the zustand store and the router in one handler, but they do
**not** land in one commit: zustand's external-store subscription forces a re-render before
the router flushes, producing an intermediate render where the store already holds the
active season while the URL still holds the dead one — and the URL wins in
`useSelectedSeason()`. On that render `seasonId` is still the dead id, so an effect that
re-runs there switches and toasts a second time. Hence `t('season.stale_season_reset')` is
resolved during render and the resolved **string** is the dep: `t`'s identity is not
guaranteed stable (it changed every render under the test i18n instance, which is how the
double-fire was found).

It costs no extra request: `useSeasons()` is the same query `SeasonSwitcher` already runs in
that layout.

## `SeasonSwitcher` (`frontend/src/components/SeasonSwitcher.tsx`)

Lists:
- the active season, always (if the user holds `season.can_view` — see below);
- upcoming seasons, never — nothing to show;
- closed seasons, only if `user.can_view_closed_seasons` (from `/auth/me/`).

**Self-hides** when there is nothing to switch between (`selectable.length <= 1`) — the
common case, since most deployments have exactly one active season.

Reads its option list from `useSeasons()` (`GET /export/admin/seasons/`), which is gated on
the **`season`** resource permission — a different permission than `closed_season`. Only
`admin`/`director`/`export_manager`/`boss` hold it by blanket default; `finansist` holds it
view-only (Task 15b) specifically so it can populate this switcher despite having no season
write access. Every other role for which `closed_season.can_view` might later be granted
would need `season: view` seeded too, or the switcher silently has nothing to show them.

## `useSeasonReadOnly()` (`frontend/src/hooks/useSeasonReadOnly.ts`)

```ts
seasonId !== user.active_season.id   // or true if active_season is null
```

Deliberately does **not** depend on `useSeasons()` (which 403s for most operational roles) —
it compares the browsed season against `/auth/me/`'s `active_season.id`, available to every
authenticated user. Per D1 only the active season is writable, so "not the active season" is
sufficient — the browsed season's own `status` is never consulted.

Drives, across the app: a `disabled` prop on every create/edit/delete control on Sheet cells,
`ShipmentList`, `ShipmentDetail` (fields, transitions, cancel, hard-delete, task cards),
`WeeklyPlanGrid` (plan/actual cells, Initialize Week, Generate Tasks, bulk grant/revoke),
`AssignmentBoard`'s Confirm button. The backend's `409 season_closed` (caught by a global
Axios interceptor toast in `services/api.ts`) is the **safety net**, not the mechanism — a
control should never be clickable to the point of needing it.

**Known gap, disclosed not fixed:** comment creation on the Shipment Detail page
(`CommentsDrawerOverlay` → `useShipmentComments`) is not gated by `useSeasonReadOnly()`. The
global 409 toast is its only backstop. Carried forward from Task 15's review, not resolved
in this branch.

## `ClosedSeasonBanner` (`frontend/src/components/ClosedSeasonBanner.tsx`)

Renders `null` when `useSeasonReadOnly()` is `false`. Otherwise branches on
`user.active_season`:

- **`null` (close→open gap):** a distinct `info` alert — `season.no_active_season_banner` —
  with no back-button (there is nothing to switch back to). Must stay distinct from the
  closed-season message below; conflating the two would describe a normal operational gap as
  a permission restriction.
- **A specific closed season is browsed:** a `warning` alert — `season.readonly_banner`,
  interpolating the season's name (falls back to `#<id>` if `useSeasons()` 403s for this
  role, e.g. `finansist`) — plus a `season.partial_view_notice` line when the user lacks
  `_ARCHIVE_VIEW_ROLES` membership (D8 — archived rows of this season are hidden from them,
  and the banner says so rather than leaving a silent gap). A "back to active season" button
  calls `useSwitchSeason()`.

## Admin: Close / Open (`SeasonsPage.tsx`, `SeasonCloseModal.tsx`)

`/admin/seasons` gains a status column (`ACTIVE`/`CLOSED`/`UPCOMING` Tag) and row actions:

| Row status | Close | Open | Edit | Delete |
|---|---|---|---|---|
| `ACTIVE` | opens `SeasonCloseModal` | — | yes | yes |
| `UPCOMING` | — | `Modal.confirm` → `POST .../open/` | yes | yes |
| `CLOSED` | — | — | **hidden** | **hidden** |

The create/edit modal carries an `is_active` `Switch` (removed 2026-08-07, **restored
2026-08-10** at the domain owner's request). It is no longer a reopen vector or a stale-state
vector, because the switch does not write the column — `SeasonViewSet.perform_create()` /
`perform_update()` delegate to `open_season()` (`false -> true`, and on create the row is
INSERTed inactive first) and `deactivate_season()` (`true -> false`), so ticking Active is
exactly the Open action with the same atomic incumbent swap and `AuditLog` row, and
`useCreateSeason`/`useUpdateSeason` now run the same blanket `queryClient.invalidateQueries()`
as `useOpenSeason`/`useCloseSeason`. **The switch defaults OFF on create** — adding next year's
row is bookkeeping and must not silently move the platform-wide write target; a new season
still lands `UPCOMING` unless the switch is ticked. Un-ticking it on the active season is a
deliberate, supported state: it stands the season down without closing it (`closed_at` stays
NULL, status returns to `UPCOMING`) and leaves no active season at all, which D7 handles by
failing closed.

Edit/Delete stay hidden on `CLOSED` rows. Activating a closed season is refused server-side
with a `400` from `SeasonSerializer.validate_is_active()` (which reuses
`Season.assert_activation_allowed()`, the same predicate `Season.save()` enforces and the one
that covers the ORM, Django admin and management commands — see AD-16), but the UI should not
offer an action the server will reject, and Delete hard-deletes a row the close dialog's
"nothing is deleted" copy promised to keep. `seasons.is_active` is used twice — the table's
Active column title and the form's switch label.

`SeasonCloseModal` fetches `GET .../{id}/close-preview/` (`useSeasonClosePreview`) and shows
the counts in the confirm body: *"Closing 2025/2026 will hide N drafts, N shipments in
transit, N open tasks, and N weekly plans still missing reported actuals. Nothing is
deleted — every record stays exactly as it is and reappears, read-only, whenever 2025/2026 is
selected in the season switcher."* This dialog is the **entire mitigation** for D2 (closing
hides unfinished work rather than blocking on it) — its accuracy matters more than usual.

On success, `useCloseSeason`/`useOpenSeason` run a **blanket** `queryClient.invalidateQueries()`
(no key filter) — deliberate: the ~26 season-scoped query keys from Task 14 would otherwise
keep serving cached rows from the just-hidden season until `staleTime` expired, and this
mutation fires at most twice a year, so a full refetch is the right trade against maintaining
an exhaustive key list by hand.

## Known open items (not fixed on this branch)

- Comment creation on Shipment Detail is not season-gated on the frontend (see above).
- Live dev-DB permission drift (not caused by this feature): `boss`'s `season` row has full
  CRUD where the seeder intends read-only, so `boss` can currently close/open seasons.
  Separately, `loading_dept_head`/`loading_dept_head_deputy` carry stray all-False `season`
  rows the seeder's defaults for those roles would not create — low consequence (all-False
  grants nothing), disclosed because neither drift self-heals on a re-seed.
- `seed_data.py`'s `update_or_create` on the seed season will raise if ever re-run after that
  season has been closed (fail-loud, state-dependent — not "structurally impossible").

## Files

| File | Role |
|---|---|
| `backend/apps/core/seasons.py` | `get_active_season()`, `resolve_season()`, `can_view_closed()`, `SeasonScopedMixin` |
| `backend/apps/core/services/season.py` | `close_season()`, `open_season()`, `close_preview()` |
| `backend/apps/core/permissions.py::SeasonNotClosed` | Write-freeze layer 1 (DRF object permission) |
| `backend/apps/export/views_admin.py::SeasonViewSet` | `close`/`open`/`close-preview` actions, `SeasonSerializer` |
| `frontend/src/stores/seasonStore.ts` | Zustand `selectedSeasonId` |
| `frontend/src/hooks/useSeasonParam.ts` | `useSeasonParam`/`useSelectedSeason`/`useSwitchSeason` |
| `frontend/src/hooks/useSeasonFallback.ts` | `useSeasonFallback()` — drops a selection whose season was deleted |
| `frontend/src/hooks/useSeasonReadOnly.ts` | `useSeasonReadOnly()` |
| `frontend/src/components/SeasonSwitcher.tsx` | Header switcher |
| `frontend/src/components/ClosedSeasonBanner.tsx` | Persistent banner |
| `frontend/src/pages/admin/SeasonsPage.tsx` | Admin list + row actions |
| `frontend/src/pages/admin/SeasonCloseModal.tsx` | Close confirm dialog with live preview counts |
| `frontend/src/hooks/useAdmin.ts` | `useSeasons`, `useSeasonClosePreview`, `useCloseSeason`, `useOpenSeason` |

## Related

- `docs/ADR.md` (AD-16) — full design rationale, D1–D10, rejected alternatives.
- [[../processes/permissions-system]] — the `closed_season` resource and its D8 archive coupling.
- [[../reference/api-endpoint-map]] — `?season=` convention and the write-freeze `409` shape.
