import { useEffect, useRef } from 'react';
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

/**
 * Read-only `{ seasonId, isReady }` — no `useSearchParams()`, no `useEffect`,
 * no URL writes. This is what every season-scoped query hook calls.
 *
 * Deliberately NOT `useSeasonParam()` itself: that hook owns two side-effecting
 * `useEffect`s (URL<->store sync) and must be mounted exactly once (in
 * `AppLayout`) — calling it from every one of the ~20 data-fetching hooks
 * instead would mount that many independent copies of the sync effects,
 * each an extra `useSearchParams()` subscription and an extra writer racing
 * to the same `?season=` param on every render. The effects are individually
 * idempotent (same shared inputs -> same computed output), so duplicate
 * mounts would not have diverged into different values — but "safe by
 * coincidence" is not the same as "correct by design", and the brief is
 * explicit that two mounts is the failure mode to avoid. This hook reads the
 * same two shared sources of truth (`useSeasonStore`, `useAuth().isLoading`)
 * with zero side effects, so any number of call sites is free.
 */
export function useSelectedSeason(): IUseSeasonParamResult {
  const { isLoading } = useAuth();
  const selectedSeasonId = useSeasonStore((s) => s.selectedSeasonId);
  return { seasonId: selectedSeasonId, isReady: !isLoading };
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

    const fromUrl = urlSeason === null ? null : Number(urlSeason);
    if (fromUrl !== null && !Number.isNaN(fromUrl)) {
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
