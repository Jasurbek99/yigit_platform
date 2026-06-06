// usePresenceSheet — call from any page that should appear in the Sheet
// presence roster (today: just ShipmentSheet). Joins on mount, leaves on
// unmount, and returns the live roster from the Zustand store.

import { useEffect } from 'react';
import { realtime } from '@/services/realtime';
import { useRealtimeStore } from '@/stores/realtimeStore';
import type { IPresenceUser } from '@/types/presence';

export function usePresenceSheet(): IPresenceUser[] {
  const roster = useRealtimeStore((s) => s.sheetRoster);

  useEffect(() => {
    realtime.send('presence.sheet', 'join');
    return () => {
      realtime.send('presence.sheet', 'leave');
    };
  }, []);

  // Also re-join when the WS reconnects after a drop — the server's in-Redis
  // roster doesn't remember a channel that disconnected, so we have to opt
  // back in.
  useEffect(() => {
    return realtime.onStatusChange((status) => {
      if (status === 'open') {
        realtime.send('presence.sheet', 'join');
      }
    });
  }, []);

  return roster;
}
