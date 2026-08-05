import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useSeasonStore } from '@/stores/seasonStore';
import { useAuth } from '@/hooks/useAuth';

interface IUseSeasonParamResult {
  seasonId: number | null;
  /**
   * True once `/auth/me/` has resolved (success OR error) — the signal every
   * season-scoped query gates `enabled` on. NOT `seasonId !== null`: a
   * resolved user with no active season (the close→open gap) is a legitimate
   * state where `seasonId` stays null forever, and the query must still fire
   * so the backend's fail-closed empty response reaches the user instead of
   * a permanently disabled query rendering a perpetual spinner.
   */
  isReady: boolean;
}

/** Parse `?season=` into a number, or `null` if absent/malformed. Pure. */
function parseUrlSeason(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/**
 * Read-only `{ seasonId, isReady }` — no URL *writes*, no `useEffect`. This is
 * what every season-scoped query hook calls.
 *
 * Deliberately NOT `useSeasonParam()` itself: that hook owns two side-effecting
 * `useEffect`s (URL<->store sync) and must be mounted exactly once (in
 * `AppLayout`) — calling it from every one of the ~20 data-fetching hooks
 * instead would mount that many independent copies of the sync effects,
 * each an extra writer racing to the same `?season=` param on every render.
 *
 * **Resolves the season SYNCHRONOUSLY at read time**, with the identical
 * precedence `useSeasonParam()`'s effects converge to (URL wins, then the
 * store, then the resolved active season) — it does NOT wait for
 * `useSeasonParam()`'s effects to run and seed the store first. This matters
 * because `AppLayout` (where `useSeasonParam()` mounts) sits ABOVE every page,
 * and React runs a CHILD's effects before its PARENT's — so on first mount, a
 * page's `useShipments()` (etc.) would otherwise fire its query before
 * `AppLayout`'s effect had a chance to write `selectedSeasonId` into the
 * store, sending an unscoped request (defaults to active season server-side),
 * followed a tick later by a second, now-scoped request once the store
 * catches up — double-fetching the full Sheet payload on every page load, and
 * flashing active-season data for one frame on a pasted `?season=99` link
 * (exactly what the URL mirroring exists to prevent). Reading the URL/store/
 * user directly on every render removes the ordering dependency entirely
 * instead of racing it.
 */
export function useSelectedSeason(): IUseSeasonParamResult {
  const [searchParams] = useSearchParams();
  const { user, isLoading } = useAuth();
  const storeSeasonId = useSeasonStore((s) => s.selectedSeasonId);

  const fromUrl = parseUrlSeason(searchParams.get('season'));
  const activeSeasonId = user?.active_season?.id ?? null;
  const seasonId = fromUrl ?? storeSeasonId ?? activeSeasonId;

  return { seasonId, isReady: !isLoading };
}

/**
 * Keeps the selected season mirrored to the URL as `?season=<id>`.
 *
 * Without this, a shared link renders whatever season the recipient last had
 * selected — silently wrong data with no visual difference from the correct
 * view. `?season=` is omitted while the selection equals the active season,
 * so the default (and by far most common) view keeps a clean URL.
 *
 * This hook does not validate the season id — a `?season=<closed id>` the
 * user cannot view, or an id that does not exist, is written to the store
 * as-is and surfaces as a 403/404 from whichever season-scoped query reads
 * `selectedSeasonId` next (Tasks 15/16 own that error handling).
 *
 * **Mount this exactly once, high in the tree** (`AppLayout`) — it owns the
 * URL<->store sync effects. Every other caller that only needs the current
 * `{ seasonId, isReady }` (every season-scoped query hook) should call
 * `useSelectedSeason()` instead, not this one.
 */
export function useSeasonParam(): IUseSeasonParamResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isLoading } = useAuth();
  const selectedSeasonId = useSeasonStore((s) => s.selectedSeasonId);
  const setSelectedSeasonId = useSeasonStore((s) => s.setSelectedSeasonId);

  const urlSeason = searchParams.get('season');
  const activeSeasonId = user?.active_season?.id ?? null;

  // Last `urlSeason` this effect actually reacted to. `undefined` is a
  // sentinel no real urlSeason value (string | null) can equal, so the
  // very first run always syncs regardless of what the URL holds on mount.
  //
  // Without this ref, a STORE-driven change (a future switcher UI calling
  // setSelectedSeasonId directly, or the effect below reacting to it) also
  // re-triggers this effect — selectedSeasonId is in its deps — and on that
  // render `urlSeason` is still the OLD value (the URL hasn't been rewritten
  // yet; that happens in the second effect, further down, same commit).
  // Comparing `fromUrl !== selectedSeasonId` at that point sees them
  // diverge and calls setSelectedSeasonId(fromUrl) right back to the STALE
  // URL value — the store-driven switch never sticks. Gating this effect's
  // BODY on urlSeason having actually changed since last observed makes it
  // fire only for genuine navigation (mount, back/forward, a pasted link),
  // never as a side-effect of the store changing for some other reason.
  const lastUrlSeasonRef = useRef<string | null | undefined>(undefined);

  // URL -> store. The URL wins on mount and on any back/forward navigation;
  // the active season from /auth/me/ is only the fallback once `user` has
  // resolved and no `?season=` is present. Runs before `user` resolves too
  // (useAuth returns `user: null` while loading, never `undefined`), which
  // is fine: with no URL param and no user yet, this is a no-op and waits
  // for `user` to change and re-trigger the effect.
  useEffect(() => {
    if (urlSeason === lastUrlSeasonRef.current) return;
    lastUrlSeasonRef.current = urlSeason;

    const fromUrl = parseUrlSeason(urlSeason);
    if (fromUrl !== null) {
      if (fromUrl !== selectedSeasonId) setSelectedSeasonId(fromUrl);
      return;
    }
    if (selectedSeasonId === null && activeSeasonId !== null) {
      setSelectedSeasonId(activeSeasonId);
    }
  }, [urlSeason, selectedSeasonId, activeSeasonId, setSelectedSeasonId]);

  // Store -> URL, but only once the selection diverges from the active
  // season (or the URL holds a stale/malformed value) — otherwise the
  // default view would carry a redundant `?season=<active id>` forever.
  // `replace: true` so switching seasons doesn't pollute the back-button
  // history the way a real navigation would; only the URL a user actually
  // typed or pasted lands in the second effect's dependency, not every
  // season switch made from a future switcher UI (Task 14).
  useEffect(() => {
    if (selectedSeasonId === null) return;
    const isDefault = selectedSeasonId === activeSeasonId;
    const current = searchParams.get('season');
    if (isDefault && current === null) return;
    if (!isDefault && current === String(selectedSeasonId)) return;

    const next = new URLSearchParams(searchParams);
    if (isDefault) next.delete('season');
    else next.set('season', String(selectedSeasonId));
    setSearchParams(next, { replace: true });
  }, [selectedSeasonId, activeSeasonId, searchParams, setSearchParams]);

  return { seasonId: selectedSeasonId, isReady: !isLoading };
}

/**
 * Programmatic season switch (Task 15: `SeasonSwitcher`, `ClosedSeasonBanner`'s
 * "back to active" action) that updates the store AND the URL in the same
 * event handler, not the store alone.
 *
 * Why not just `setSelectedSeasonId`: `useSelectedSeason()` resolves
 * `URL ?? store ?? active` — the URL wins. If a stale `?season=<closed>` is
 * still in the address bar and a caller only flips the store back to the
 * active season, `useSelectedSeason()` keeps resolving the OLD season from
 * the URL for a render (the store->URL effect in `useSeasonParam()` is a
 * separate `useEffect` that fires a tick later). Calling
 * `setSelectedSeasonId` and `setSearchParams` together, synchronously, in one
 * handler lets React 18 batch them into a single commit, so the URL is never
 * stale for even one render. Mirrors the store->URL effect's own
 * default-omits-the-param logic so both paths agree on what "clean" looks
 * like.
 */
export function useSwitchSeason(): (seasonId: number) => void {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const setSelectedSeasonId = useSeasonStore((s) => s.setSelectedSeasonId);
  const activeSeasonId = user?.active_season?.id ?? null;

  return useCallback(
    (seasonId: number) => {
      setSelectedSeasonId(seasonId);
      const isDefault = seasonId === activeSeasonId;
      const next = new URLSearchParams(searchParams);
      if (isDefault) next.delete('season');
      else next.set('season', String(seasonId));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams, activeSeasonId, setSelectedSeasonId],
  );
}
