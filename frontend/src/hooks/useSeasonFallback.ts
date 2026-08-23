import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useSeasons } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useSelectedSeason, useSwitchSeason } from '@/hooks/useSeasonParam';

/**
 * Self-heals a selection pointing at a season that no longer exists.
 *
 * `useSelectedSeason()` resolves `URL ?? store ?? active` and deliberately
 * does not validate the id — a `?season=<gone>` is passed straight through to
 * the backend, where `resolve_season()` raises `NotFound` and EVERY
 * season-scoped query on the page 404s at once. That is the right server
 * behaviour (an empty list for a season the user picked would be a lie), but
 * on the client it is unrecoverable by refresh: the store->URL effect in
 * `useSeasonParam()` sees the dead id as "not the default" and writes it back
 * into `?season=` on every load, so the broken state reproduces itself. The
 * only escapes were editing the address bar by hand or using the switcher —
 * and the switcher hides itself when fewer than two seasons are selectable.
 *
 * Deleting a season is the realistic way to get here (a bookmark or an open
 * tab outlives the row), which is exactly when the affected user is least
 * likely to connect a wall of 404s to a stale URL param.
 *
 * **Mount this exactly once, high in the tree** (`AppLayout`, beside
 * `useSeasonParam()`). It adds no network cost: `useSeasons()` is the same
 * `['admin-seasons']` query `SeasonSwitcher` already runs in that layout, so
 * TanStack serves it from cache. Roles without `season.can_view` get an error
 * from that query and this hook stays inert for them — it cannot tell a
 * deleted season from one it is not allowed to list, and guessing would be
 * worse than the 404.
 */
export function useSeasonFallback(): void {
  const { t } = useTranslation();
  const { data: seasons, isSuccess, isFetching } = useSeasons();
  const { seasonId } = useSelectedSeason();
  const { user } = useAuth();
  const switchSeason = useSwitchSeason();

  const activeSeasonId = user?.active_season?.id ?? null;
  // EVERY DEP OF THE EFFECT BELOW MUST BE STABLE ACROSS A RENDER THAT CHANGES
  // NOTHING IT READS. `useSwitchSeason()` writes the zustand store and the
  // router in one handler, but they do NOT land in one commit: zustand's
  // external-store subscription forces a re-render before the router flushes,
  // so there is an intermediate render where the store already holds the
  // active season while the URL still holds the dead one — and the URL wins in
  // `useSelectedSeason()`. On that render `seasonId` is still the dead id, so
  // an effect that re-runs there switches and toasts a second time.
  //
  // Hence resolving the message during render rather than calling `t` inside
  // the effect: `t`'s identity is not guaranteed stable (it changed on every
  // render under the test i18n instance, which is how the double-fire was
  // found), while the resolved string is.
  const message = t('season.stale_season_reset');

  useEffect(() => {
    // Settled list only. A mid-refetch cache can legitimately lag a season the
    // user just created and is already browsing (`staleTime` is 60s), and
    // switching away from it would look like the create silently failed.
    if (!isSuccess || isFetching || !seasons?.length) return;
    // Nothing selected, or nowhere to fall back to (the legitimate
    // no-active-season gap) — leave it alone.
    if (seasonId === null || activeSeasonId === null) return;
    if (seasonId === activeSeasonId) return;
    if (seasons.some((s) => s.id === seasonId)) return;

    switchSeason(activeSeasonId);
    toast.info(message);
  }, [isSuccess, isFetching, seasons, seasonId, activeSeasonId, switchSeason, message]);
}
