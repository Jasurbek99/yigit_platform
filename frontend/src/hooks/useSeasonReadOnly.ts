import { useSeasons } from '@/hooks/useAdmin';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import type { ISeason } from '@/types';

/**
 * True when the season currently being browsed is closed.
 *
 * Drives the banner and every disabled control. The backend's 409
 * (`season_closed`) is the safety net, not the mechanism — a user should
 * never be able to click something that 409s.
 *
 * Reads `useSelectedSeason()` (URL ?? store ?? active season, resolved
 * synchronously), NOT the raw `useSeasonStore` value directly — that store
 * value starts `null` and is only seeded by `useSeasonParam()`'s effect
 * *after* first render. A user landing on a pasted `?season=<closed id>`
 * link would see `isReadOnly: false` for a frame if this read the store
 * instead, since the effect hasn't run yet. `useSelectedSeason()` is the same
 * resolution every season-scoped query hook already uses (Task 14), so this
 * hook's answer always agrees with what those hooks are actually fetching.
 */
export function useSeasonReadOnly(): boolean {
  const { seasonId } = useSelectedSeason();
  const { data: seasons = [] } = useSeasons();
  const selected = seasons.find((s: ISeason) => s.id === seasonId);
  return selected?.status === 'CLOSED';
}
