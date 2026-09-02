import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

type Handler = (payload: unknown) => void;
type StatusListener = (s: string) => void;

const pokeHandlers: Handler[] = [];
const statusListeners: StatusListener[] = [];
const unsubPoke = vi.fn();
const unsubStatus = vi.fn();
/** What the socket reports at subscribe time. Mutable so a test can subscribe mid-outage. */
let initialStatus = 'open';
/** Mutable so a test can switch season and re-run the effect. */
let currentSeasonId = 1;

// The unsubscribe functions actually detach, exactly as realtime.ts does — a
// no-op stub would let the cleanup test pass even if the hook never unsubscribed.
vi.mock('@/services/realtime', () => ({
  realtime: {
    on: (channel: string, type: string, handler: Handler) => {
      if (channel === 'sheet' && type === 'changed') pokeHandlers.push(handler);
      return () => {
        unsubPoke();
        const i = pokeHandlers.indexOf(handler);
        if (i >= 0) pokeHandlers.splice(i, 1);
      };
    },
    onStatusChange: (listener: StatusListener) => {
      statusListeners.push(listener);
      listener(initialStatus); // mirrors the real client's immediate invoke
      return () => {
        unsubStatus();
        const i = statusListeners.indexOf(listener);
        if (i >= 0) statusListeners.splice(i, 1);
      };
    },
  },
}));

vi.mock('@/hooks/useSeasonParam', () => ({
  useSelectedSeason: () => ({ seasonId: currentSeasonId, isReady: true }),
}));

import { useSheetLiveSync } from './useSheetLiveSync';
import { useSheetStore } from '@/stores/sheetStore';

const SEASON_KEY = ['shipments', 'sheet', 1];
const ME = 1;
const SOMEONE_ELSE = 2;

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

/** Deliver a poke frame as the server would. */
function poke(shipment_ids: number[], by_user_id: number) {
  pokeHandlers.forEach((h) => h({ shipment_ids, by_user_id }));
}

function setStatus(status: string) {
  statusListeners.forEach((l) => l(status));
}

describe('useSheetLiveSync', () => {
  let client: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    initialStatus = 'open';
    currentSeasonId = 1;
    pokeHandlers.length = 0;
    statusListeners.length = 0;
    unsubPoke.mockClear();
    unsubStatus.mockClear();
    useSheetStore.setState({ editingCell: null });

    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], { id: ME });
    // Replace rather than spy: invalidateQueries is generic and a typed spy
    // handle does not narrow to a plain mock signature.
    invalidateSpy = vi.fn(async () => undefined);
    client.invalidateQueries = invalidateSpy as unknown as QueryClient['invalidateQueries'];
    // Default: the refetch landed. Individual tests override.
    client.getQueryState = vi.fn(() => ({ isInvalidated: false })) as unknown as
      QueryClient['getQueryState'];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mount() {
    return renderHook(() => useSheetLiveSync(), { wrapper: wrapperFor(client) });
  }

  /**
   * Every other test stubs isMutating, so nothing else would notice if the real
   * method vanished — and the guard calls it inside a setTimeout with no catch,
   * where a TypeError would silently kill every poke.
   */
  it('relies on a QueryClient method that actually exists', () => {
    expect(typeof new QueryClient().isMutating).toBe('function');
  });

  /** The frequent case: your own keystroke saves must cost zero network. */
  it('skips a poke that originated from the current user', async () => {
    mount();
    poke([5], ME);
    await vi.advanceTimersByTimeAsync(2000);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates the season sheet and the poked row for another user edit', async () => {
    mount();
    poke([5], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(500);

    const keys = invalidateSpy.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toContainEqual(SEASON_KEY);
    expect(keys).toContainEqual(['shipments', 'sheet', 'row', 5]);
    expect(invalidateSpy.mock.calls[0][0].exact).toBe(true);
  });

  it('coalesces a burst of pokes into one season refetch with the ids unioned', async () => {
    mount();
    poke([5], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(100);
    poke([6], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(100);
    poke([7], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(500);

    const keys = invalidateSpy.mock.calls.map((c) => c[0].queryKey);
    expect(keys.filter((k) => JSON.stringify(k) === JSON.stringify(SEASON_KEY))).toHaveLength(1);
    expect(keys).toContainEqual(['shipments', 'sheet', 'row', 5]);
    expect(keys).toContainEqual(['shipments', 'sheet', 'row', 6]);
    expect(keys).toContainEqual(['shipments', 'sheet', 'row', 7]);
  });

  it('defers while one of my own writes is in flight, then flushes', async () => {
    client.isMutating = vi.fn(() => 1) as unknown as QueryClient['isMutating'];
    mount();
    poke([5], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(invalidateSpy).not.toHaveBeenCalled();

    client.isMutating = vi.fn(() => 0) as unknown as QueryClient['isMutating'];
    await vi.advanceTimersByTimeAsync(500);
    expect(invalidateSpy).toHaveBeenCalled();
  });

  /**
   * Product decision: the editor guard is UNBOUNDED. Columns must not slide
   * out from under the cursor, however long the editor stays open.
   */
  it('holds the poke indefinitely while a cell editor is open, then flushes on close', async () => {
    useSheetStore.setState({ editingCell: { shipmentId: 5, rowKey: 'weight_net' } });
    mount();
    poke([9], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(invalidateSpy).not.toHaveBeenCalled();

    useSheetStore.setState({ editingCell: null });
    await vi.advanceTimersByTimeAsync(500);

    const keys = invalidateSpy.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toContainEqual(SEASON_KEY);
    expect(keys).toContainEqual(['shipments', 'sheet', 'row', 9]); // ids preserved
  });

  /**
   * useShipmentPatch.onMutate calls cancelQueries(['shipments']), which aborts
   * our refetch. invalidateQueries still resolves, so isInvalidated is the only
   * honest signal that fresh data landed.
   */
  it('retries when the refetch was cancelled by a concurrent mutation', async () => {
    let landed = false;
    client.getQueryState = vi.fn(() => ({ isInvalidated: !landed })) as unknown as
      QueryClient['getQueryState'];

    mount();
    poke([5], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(500);
    const afterFirst = invalidateSpy.mock.calls.filter(
      (c) => JSON.stringify(c[0].queryKey) === JSON.stringify(SEASON_KEY),
    ).length;
    expect(afterFirst).toBe(1);

    landed = true;
    await vi.advanceTimersByTimeAsync(500);
    const afterRetry = invalidateSpy.mock.calls.filter(
      (c) => JSON.stringify(c[0].queryKey) === JSON.stringify(SEASON_KEY),
    ).length;
    expect(afterRetry).toBe(2);
  });

  it('skips the per-row invalidates once more than ten ids have piled up', async () => {
    useSheetStore.setState({ editingCell: { shipmentId: 1, rowKey: 'weight_net' } });
    mount();
    for (let id = 1; id <= 11; id += 1) poke([id], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(1000);

    useSheetStore.setState({ editingCell: null });
    await vi.advanceTimersByTimeAsync(500);

    const keys = invalidateSpy.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toContainEqual(SEASON_KEY);
    expect(keys.some((k) => k[2] === 'row')).toBe(false);
  });

  it('refetches after a reconnect but not on the first connect', async () => {
    mount(); // subscribe fires 'open' immediately
    await vi.advanceTimersByTimeAsync(1000);
    expect(invalidateSpy).not.toHaveBeenCalled();

    setStatus('closed');
    setStatus('open');
    await vi.advanceTimersByTimeAsync(500);

    const keys = invalidateSpy.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toContainEqual(SEASON_KEY);
    expect(keys.some((k) => k[2] === 'row')).toBe(false); // reconnect knows no ids
  });


  // ── regressions found in review, 2026-09-02 ─────────────────────────────

  /**
   * The pending batch is a single mutable object. A poke arriving mid-flush
   * merged into it, and the flush then cleared the whole object on its way out
   * — so the newcomer was never refetched and no timer was left to sweep it.
   * Its write landed AFTER the in-flight GET went out, so the GET cannot have
   * covered it.
   */
  it('does not lose a poke that arrives while a flush is awaiting', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    invalidateSpy = vi.fn(async () => {
      call += 1;
      if (call === 1) await gate; // hold the first season invalidate open
    });
    client.invalidateQueries = invalidateSpy as unknown as QueryClient['invalidateQueries'];

    mount();
    poke([5], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(500); // flush starts and parks on the gate

    poke([6], SOMEONE_ELSE); // merges into the in-flight batch
    release();
    await vi.advanceTimersByTimeAsync(1000);

    const keys = invalidateSpy.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toContainEqual(['shipments', 'sheet', 'row', 6]);
  });

  /**
   * Same root cause, worse blast radius: `pending`/`timer` are refs that
   * survive an effect re-run, so a flush left over from the old season used to
   * null out the batch the NEW season had just created — losing that poke and
   * leaving the new season's key never invalidated.
   */
  it('a flush left over from the previous season does not wipe the new one', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    invalidateSpy = vi.fn(async () => {
      call += 1;
      if (call === 1) await gate;
    });
    client.invalidateQueries = invalidateSpy as unknown as QueryClient['invalidateQueries'];

    const { rerender } = mount();
    poke([5], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(500); // season-1 flush parks on the gate

    currentSeasonId = 2;
    rerender(); // effect tears down and re-runs with the new season key
    poke([7], SOMEONE_ELSE);
    release();
    await vi.advanceTimersByTimeAsync(1000);

    const keys = invalidateSpy.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toContainEqual(['shipments', 'sheet', 2]);
    expect(keys).toContainEqual(['shipments', 'sheet', 'row', 7]);
  });

  /**
   * onStatusChange replays the CURRENT status on subscribe. Consuming that
   * first value blindly meant subscribing mid-outage looked like a healthy
   * connection, so the following 'open' was not treated as a reconnect and the
   * frames missed while down were never swept.
   */
  it('treats the following open as a reconnect when it subscribed while down', async () => {
    initialStatus = 'closed';
    mount();
    await vi.advanceTimersByTimeAsync(500);
    expect(invalidateSpy).not.toHaveBeenCalled();

    setStatus('open');
    await vi.advanceTimersByTimeAsync(500);

    const keys = invalidateSpy.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toContainEqual(SEASON_KEY);
  });

  /**
   * `attempts` is shared by the whole batch. A fresh poke merged into a batch
   * that had already burned most of its retry budget on cancelled invalidates
   * inherited the count and could give up almost immediately.
   */
  it('gives a newly merged poke a fresh retry budget', async () => {
    let landed = false;
    client.getQueryState = vi.fn(() => ({ isInvalidated: !landed })) as unknown as
      QueryClient['getQueryState'];

    mount();
    poke([5], SOMEONE_ELSE);
    // Burn most of the shared budget (MAX_CONFIRM_ATTEMPTS = 25, retry 400ms)
    // WITHOUT exhausting it, so the batch is still alive when the next poke
    // merges into it. Exhausting it first would discard the batch and hand the
    // newcomer a fresh object anyway, hiding the bug.
    await vi.advanceTimersByTimeAsync(9_600);

    poke([8], SOMEONE_ELSE); // inherits the burnt budget unless it is reset
    await vi.advanceTimersByTimeAsync(1_200); // still cancelled — old code gives up here

    // Clear AFTER the give-up: the giving-up flush still fires one invalidate,
    // so only calls made from here on distinguish "still retrying" from "dead".
    invalidateSpy.mockClear();
    landed = true;
    await vi.advanceTimersByTimeAsync(2_000);

    const keys = invalidateSpy.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toContainEqual(SEASON_KEY);
    expect(keys).toContainEqual(['shipments', 'sheet', 'row', 8]);
  });

  it('unsubscribes on unmount and ignores late pokes', async () => {
    const { unmount } = mount();
    unmount();
    expect(unsubPoke).toHaveBeenCalled();
    expect(unsubStatus).toHaveBeenCalled();

    poke([5], SOMEONE_ELSE);
    await vi.advanceTimersByTimeAsync(2000);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
