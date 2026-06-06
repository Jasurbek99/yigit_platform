// useRealtime — mount once at the app layout level. Opens the WS as soon as
// auth resolves, wires the singleton's status + presence.sheet roster into
// the Zustand store, and tears down on unmount/logout.

import { useEffect } from 'react';
import { realtime } from '@/services/realtime';
import { useRealtimeStore } from '@/stores/realtimeStore';
import type { IPresenceRosterPayload } from '@/types/presence';

interface IUseRealtimeOptions {
  /** If false, the hook does nothing (e.g. while auth is still loading). */
  enabled: boolean;
}

export function useRealtime({ enabled }: IUseRealtimeOptions): void {
  const setStatus = useRealtimeStore((s) => s.setStatus);
  const setSheetRoster = useRealtimeStore((s) => s.setSheetRoster);

  useEffect(() => {
    if (!enabled) return;

    const unsubStatus = realtime.onStatusChange(setStatus);
    const unsubRoster = realtime.on('presence.sheet', 'roster', (payload) => {
      const users = (payload as IPresenceRosterPayload | undefined)?.users ?? [];
      setSheetRoster(users);
    });
    realtime.connect();

    return () => {
      unsubStatus();
      unsubRoster();
      // Don't close the singleton on hook unmount — AppLayout re-mounts often
      // (e.g. route changes can re-create wrappers). The singleton's own
      // beforeunload listener handles tab close.
    };
  }, [enabled, setStatus, setSheetRoster]);
}
