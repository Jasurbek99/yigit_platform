import type { ISeason } from '@/types';

/**
 * The seasons a user may pick in the quota dashboard's own season filter.
 *
 * `GET /export/quota-dashboard/` now resolves `?season=` through
 * `resolve_season()` like every other read path, so selecting a closed season
 * without `closed_season.can_view` returns 403 — which the page can only
 * render as "Failed to load quota data". Hiding the option is the honest
 * answer: the same rule the header `SeasonSwitcher` applies.
 *
 * UPCOMING seasons stay listed (unlike in the header switcher) — they are
 * pickable today, they carry no permission gate, and an upcoming season simply
 * aggregates to zero.
 */
export function seasonsVisibleTo(seasons: ISeason[], canViewClosed: boolean): ISeason[] {
  if (canViewClosed) return seasons;
  return seasons.filter((s) => s.status !== 'CLOSED');
}
