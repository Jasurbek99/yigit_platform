// useSheetLiveSync — mount on the Shipment Sheet page only.
//
// The server broadcasts a poke (`sheet:changed`, ids + author, never row data)
// whenever anyone writes to a shipment. This hook turns that into a refetch of
// the sheet query, so two people editing the same season see each other.
//
// Three things this deliberately does NOT do:
//
//  1. It never refetches for your OWN writes. useShipmentPatch already folds
//     the server response into the cache (reconcileFromServer) and
//     invalidateExceptSheet exists precisely to keep every keystroke from
//     refetching the whole unpaginated season. Skipping self-originated pokes
//     is what keeps that design intact — the frequent case costs nothing.
//
//  2. It never refetches while one of your own writes is in flight.
//     useShipmentPatch.onMutate calls cancelQueries(['shipments']), which would
//     abort our refetch mid-air and leave the query invalidated-but-idle. Worse,
//     a GET issued before your PATCH commits comes back without your value and
//     stomps the optimistic cache — the cell visibly reverts.
//
//  3. It never refetches while a cell editor is open. Typed text survives (the
//     editors are uncontrolled), but the Sheet is transposed: a shipment created
//     by someone else lands at the left edge and shifts every column right,
//     under your cursor. Per the product decision this wait is UNBOUNDED — the
//     poke is held, not dropped, and lands the moment you close the editor.
//
// Both guards are read imperatively (isMutating() / getState()), never through
// a reactive subscription: ShipmentSheet re-renders the non-memoized SheetGrid,
// so a subscription here would cost a full grid render per keystroke.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { realtime } from '@/services/realtime';
import { sheetKeyFor } from '@/hooks/useShipmentPatch';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import { useSheetStore } from '@/stores/sheetStore';
import type { ICurrentUser } from '@/types';
import type { ISheetChangedPayload } from '@/types/presence';

/** Coalesce a burst of pokes into one refetch. */
const POKE_DEBOUNCE_MS = 400;
/** How often to re-check a guard that is currently holding the refetch back. */
const GUARD_RETRY_MS = 400;
/**
 * Above this many accumulated ids, skip the per-row invalidates entirely — the
 * season refetch is authoritative anyway, and a long editing session can pile
 * up an unbounded number of ids behind the (uncapped) editor guard.
 */
const MAX_ROW_INVALIDATES = 10;
/** Give up re-confirming a refetch after ~10s; window-focus is the backstop. */
const MAX_CONFIRM_ATTEMPTS = 25;

interface IPending {
  ids: Set<number>;
  attempts: number;
}

export function useSheetLiveSync(): void {
  const queryClient = useQueryClient();
  const { seasonId } = useSelectedSeason();

  const pending = useRef<IPending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const seasonKey = sheetKeyFor(seasonId);

    function arm(delay: number): void {
      // Already armed — a poke storm must not keep pushing the deadline out.
      if (timer.current !== null) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void flush();
      }, delay);
    }

    function schedule(ids: number[]): void {
      const next = pending.current ?? { ids: new Set<number>(), attempts: 0 };
      const sizeBefore = next.ids.size;
      ids.forEach((id) => next.ids.add(id));
      // A genuinely new poke (or a reconnect sweep) gets a fresh retry budget.
      // Without this it inherits `attempts` already burnt by earlier cancelled
      // invalidates and can hit the cap after a single retry of its own.
      if (ids.length === 0 || next.ids.size !== sizeBefore) next.attempts = 0;
      pending.current = next;
      arm(POKE_DEBOUNCE_MS);
    }

    async function flush(): Promise<void> {
      const current = pending.current;
      if (current === null) return;

      // Guards defer, never drop. No attempt counter here on purpose: the
      // editor guard is deliberately unbounded.
      if (queryClient.isMutating() > 0 || useSheetStore.getState().editingCell !== null) {
        arm(GUARD_RETRY_MS);
        return;
      }

      // Snapshot: ids added while we await below were NOT covered by the
      // refetch this call triggers, because their write landed after the GET
      // went out.
      const ids = [...current.ids];
      await queryClient.invalidateQueries({ queryKey: seasonKey, exact: true });
      if (ids.length > 0 && ids.length <= MAX_ROW_INVALIDATES) {
        await Promise.all(
          ids.map((id) =>
            queryClient.invalidateQueries({
              queryKey: ['shipments', 'sheet', 'row', id],
              exact: true,
            }),
          ),
        );
      }

      // We awaited, so the world may have moved: the effect may have been torn
      // down and re-run (season switch), or another flush may have taken over.
      // Touching `pending.current` now would clobber a batch that belongs to
      // someone else — and clearing it would strand every id inside it.
      if (pending.current !== current) return;

      // invalidateQueries resolves even when a concurrent cancelQueries aborted
      // the refetch, so its promise proves nothing. isInvalidated clearing is
      // the only honest signal that fresh data actually landed. A query that
      // isn't cached at all (no state) has nothing to wait for.
      const state = queryClient.getQueryState(seasonKey);
      const landed = state === undefined || state.isInvalidated === false;

      if (landed) {
        ids.forEach((id) => current.ids.delete(id));
        if (current.ids.size === 0) {
          pending.current = null;
          return;
        }
        // Ids that arrived mid-flight survived the delete above — sweep them
        // with their own refetch instead of dropping them on the floor.
        current.attempts = 0;
        arm(GUARD_RETRY_MS);
        return;
      }

      current.attempts += 1;
      if (current.attempts >= MAX_CONFIRM_ATTEMPTS) {
        pending.current = null;
        console.warn('[sheet-live-sync] gave up refetching after a cancelled invalidate');
        return;
      }
      arm(GUARD_RETRY_MS);
    }

    const unsubPoke = realtime.on('sheet', 'changed', (payload) => {
      const frame = payload as ISheetChangedPayload | undefined;
      if (!frame) return;
      // Read the current user from the cache rather than useAuth(): that hook
      // navigates to /login on error, which is not this hook's business, and a
      // subscription here would re-render the grid.
      const myId = queryClient.getQueryData<ICurrentUser>(['auth', 'me'])?.id;
      // Fails OPEN on purpose: with no cached identity we refetch rather than
      // skip. A wasted refetch of your own already-authoritative data is
      // harmless (the isMutating guard rules out a revert); silently skipping
      // would hide a colleague's edit for good. ProtectedRoute resolves
      // /auth/me/ before this page renders, so this is a cold-cache edge only.
      if (myId !== undefined && frame.by_user_id === myId) return;
      schedule(frame.shipment_ids ?? []);
    });

    // Frames sent while our socket was down are gone for good — the server
    // keeps no history. A reconnect therefore needs one blind full refetch.
    let isFirstStatusCallback = true;
    let sawDisconnect = false;
    const unsubStatus = realtime.onStatusChange((status) => {
      if (isFirstStatusCallback) {
        // onStatusChange invokes the listener immediately on subscribe. That
        // first value is not an event — but if it says we are currently DOWN
        // (subscribing mid-outage, e.g. a season switch during a reconnect),
        // the eventual 'open' still has to count as a reconnect and sweep.
        isFirstStatusCallback = false;
        if (status !== 'open') sawDisconnect = true;
        return;
      }
      if (status !== 'open') {
        sawDisconnect = true;
        return;
      }
      if (!sawDisconnect) return; // first real connect, not a reconnect
      sawDisconnect = false;
      schedule([]);
    });

    return () => {
      unsubPoke();
      unsubStatus();
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      pending.current = null;
    };
  }, [queryClient, seasonId]);
}
