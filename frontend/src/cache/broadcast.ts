/**
 * BroadcastChannel wrapper for cross-tab cache invalidation (Phase 2b).
 *
 * When the user has the Sheet open in multiple tabs (a common dev workflow,
 * and not unusual in production), a save in tab A must surface in tab B
 * without waiting for the next manual refresh. We post a small message
 * over the browser's BroadcastChannel API; subscribers in other tabs read
 * the IDB cache + invalidate their TanStack Query so the UI re-renders.
 *
 * No payload — the message is just a pulse. Receivers re-read from IDB
 * (which the publisher already wrote) so we never have to serialize the
 * actual value over the channel.
 *
 * Falls back to a no-op when BroadcastChannel is unavailable (older
 * browsers, sandboxed iframes). Same-tab consumers are unaffected — they
 * react to TanStack Query invalidation, not to channel messages.
 */

const CHANNEL_NAME = 'ygt-sheet-prefs';

type PrefsBroadcastMessage = { type: 'prefs-changed'; user_id: number };
type Listener = (msg: PrefsBroadcastMessage) => void;

let channel: BroadcastChannel | null = null;
const listeners = new Set<Listener>();

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (e: MessageEvent<PrefsBroadcastMessage>) => {
      if (!e.data || e.data.type !== 'prefs-changed') return;
      listeners.forEach((fn) => {
        try {
          fn(e.data);
        } catch {
          // Listener errors must not break sibling listeners.
        }
      });
    });
    return channel;
  } catch {
    return null;
  }
}

/**
 * Notify other tabs that this user's prefs have changed. They will re-read
 * IDB and invalidate their TanStack Query cache.
 */
export function broadcastPrefsChanged(userId: number): void {
  const ch = ensureChannel();
  if (!ch || !userId) return;
  try {
    ch.postMessage({ type: 'prefs-changed', user_id: userId } satisfies PrefsBroadcastMessage);
  } catch {
    // Swallow — best-effort sync.
  }
}

/**
 * Subscribe to prefs-changed messages from other tabs. Returns an unsubscribe
 * function — call it from a useEffect cleanup.
 */
export function onPrefsChanged(fn: Listener): () => void {
  ensureChannel(); // ensure the receive loop is wired up
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
