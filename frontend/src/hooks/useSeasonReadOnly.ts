import { useAuth } from '@/hooks/useAuth';
import { useSelectedSeason } from '@/hooks/useSeasonParam';

/**
 * True when the season currently being browsed is NOT the write-target
 * (active) season.
 *
 * Drives the banner and every disabled control. The backend's 409
 * (`season_closed`) is the safety net, not the mechanism — a user should
 * never be able to click something that 409s.
 *
 * Deliberately does NOT read `useSeasons()` (the `/export/admin/seasons/`
 * list, gated by the `season` resource permission — distinct from the
 * `closed_season` permission Task 8 seeded for the 5 browse-closed-season
 * roles). Per `apps/core/management/commands/seed_permissions.py`, only
 * `admin`/`director`/`export_manager` (blanket `_VCRUD` spreads) and `boss`
 * (blanket `_VIEW` spread) hold ANY permission on the `season` resource code
 * — every other role's `RESOURCE_DEFAULTS` entry is itemized and omits
 * `season` entirely, so `useSeasons()` 403s for them, including `finansist`
 * (one of the 5 roles explicitly granted `closed_season.can_view`). Basing
 * this hook on that list would make it permanently `false` — every gate it
 * drives inert — for the majority of operational roles (sales_rep,
 * document_team, transport, warehouse_chief, loading_dept_head, weight_master,
 * accountant, greenhouse_manager, seller), the exact opposite of fail-closed.
 *
 * Instead compares the resolved browsed season (`useSelectedSeason()`) against
 * `user.active_season.id` from `/auth/me/` — available to every authenticated
 * user regardless of the `season`/`closed_season` resource permissions, and
 * per D1 only the active season is writable, so "not the active season" IS
 * "read-only," full stop, no need to know the browsed season's `status` at
 * all. `useSeasons()` is still used by `SeasonSwitcher`/`ClosedSeasonBanner`
 * for DISPLAY (the season's name, the switcher's option list) — those degrade
 * gracefully (an empty switcher, a banner with no name) for roles it 403s on,
 * but the read-only decision itself never depends on it.
 *
 * No active season at all (the legitimate close→open gap, `active_season:
 * null`) is also read-only — matches the backend's fail-closed behaviour
 * (`resolve_season()` returning `None` -> every scoped `get_queryset()`
 * returns `qs.none()`): there is no writable target until an admin opens the
 * next season, so nothing should be editable in that gap either.
 */
export function useSeasonReadOnly(): boolean {
  const { seasonId } = useSelectedSeason();
  const { user } = useAuth();
  const activeSeasonId = user?.active_season?.id ?? null;
  if (activeSeasonId === null) return true;
  return seasonId !== activeSeasonId;
}
