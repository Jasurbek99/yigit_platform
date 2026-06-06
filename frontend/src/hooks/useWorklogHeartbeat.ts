// useWorklogHeartbeat — mount once at the app layout level. Sends
// `worklog.heartbeat / start` on every fresh WS open with a stable
// per-tab UUID + a small `client_info` string, then ticks every
// HEARTBEAT_INTERVAL_MS while the socket stays open.
//
// "Tab open at all" counts as working (locked decision) — no Page
// Visibility / input tracking. The backend caps each tick add to
// 2 × HEARTBEAT_INTERVAL_SECONDS so a long laptop sleep doesn't pad time.

import { useEffect, useRef } from 'react';
import { realtime } from '@/services/realtime';
import type { IRealtimeStatus } from '@/types/presence';

// Should match WS_HEARTBEAT_INTERVAL_SECONDS env on the backend (default 30 s).
// We send slightly under the server's cap window to avoid edge cases when the
// browser delays a setInterval tick.
const HEARTBEAT_INTERVAL_MS = 30_000;
const TAB_SESSION_KEY = 'ygt:tab_session_id';

function getOrCreateTabSessionId(): string {
  try {
    let id = sessionStorage.getItem(TAB_SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      sessionStorage.setItem(TAB_SESSION_KEY, id);
    }
    return id.slice(0, 40);
  } catch {
    return `tab-${Date.now()}`;
  }
}

function clientInfoString(): string {
  return (navigator.userAgent || 'unknown').slice(0, 240);
}

interface IUseWorklogHeartbeatOptions {
  enabled: boolean;
}

export function useWorklogHeartbeat({ enabled }: IUseWorklogHeartbeatOptions): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const tabId = getOrCreateTabSessionId();
    const ua = clientInfoString();

    const startHeartbeats = () => {
      realtime.send('worklog.heartbeat', 'start', { tab_session_id: tabId, client_info: ua });
      if (intervalRef.current === null) {
        intervalRef.current = setInterval(() => {
          realtime.send('worklog.heartbeat', 'tick');
        }, HEARTBEAT_INTERVAL_MS);
      }
    };

    const stopHeartbeats = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const unsub = realtime.onStatusChange((status: IRealtimeStatus) => {
      if (status === 'open') startHeartbeats();
      else stopHeartbeats();
    });

    return () => {
      unsub();
      stopHeartbeats();
    };
  }, [enabled]);
}
