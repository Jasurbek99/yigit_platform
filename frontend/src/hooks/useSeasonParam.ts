import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useSeasonStore } from '@/stores/seasonStore';
import { useAuth } from '@/hooks/useAuth';

interface IUseSeasonParamResult {
  seasonId: number | null;
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
 */
export function useSeasonParam(): IUseSeasonParamResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const selectedSeasonId = useSeasonStore((s) => s.selectedSeasonId);
  const setSelectedSeasonId = useSeasonStore((s) => s.setSelectedSeasonId);

  const urlSeason = searchParams.get('season');
  const activeSeasonId = user?.active_season?.id ?? null;

  // URL -> store. The URL wins on mount and on any back/forward navigation;
  // the active season from /auth/me/ is only the fallback once `user` has
  // resolved and no `?season=` is present. Runs before `user` resolves too
  // (useAuth returns `user: null` while loading, never `undefined`), which
  // is fine: with no URL param and no user yet, this is a no-op and waits
  // for `user` to change and re-trigger the effect.
  useEffect(() => {
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

  return { seasonId: selectedSeasonId };
}
