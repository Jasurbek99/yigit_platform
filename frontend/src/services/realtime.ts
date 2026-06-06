// Realtime WebSocket client — singleton, lives outside React.
//
// One socket per browser tab. Multiplexes channels via the envelope
// { channel, type, payload }. Subscribers register handlers per
// (channel, type) pair via on(); send() emits to the server.
//
// Reconnect policy:
//   - Exponential backoff capped at 30 s.
//   - Only attempt while navigator.onLine === true; otherwise wait for the
//     browser's `online` event before retrying.
//   - When the user logs out, call close() — it suppresses reconnect.

import type { IRealtimeFrame, IRealtimeStatus } from '@/types/presence';

type Handler = (payload: unknown) => void;

const WS_PATH = '/ws/app/';
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

class RealtimeClient {
  private socket: WebSocket | null = null;
  private status: IRealtimeStatus = 'closed';
  private statusListeners = new Set<(s: IRealtimeStatus) => void>();
  private handlers = new Map<string, Set<Handler>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitlyClosed = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleBrowserOnline);
      window.addEventListener('beforeunload', () => this.close());
    }
  }

  // ── public API ───────────────────────────────────────────────────────

  connect(): void {
    this.explicitlyClosed = false;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return; // already connecting/open
    }
    this.openSocket();
  }

  close(): void {
    this.explicitlyClosed = true;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus('closed');
  }

  send<TPayload>(channel: string, type: string, payload?: TPayload): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      // Silently drop — presence is best-effort. A reconnect will pull a fresh
      // roster anyway because the consumer re-broadcasts on every join.
      return;
    }
    const frame: IRealtimeFrame<TPayload> = { channel, type, payload };
    this.socket.send(JSON.stringify(frame));
  }

  /** Subscribe to (channel, type) frames. Returns an unsubscribe function. */
  on(channel: string, type: string, handler: Handler): () => void {
    const key = `${channel}:${type}`;
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  onStatusChange(listener: (s: IRealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): IRealtimeStatus {
    return this.status;
  }

  // ── internals ────────────────────────────────────────────────────────

  private openSocket(): void {
    const url = this.buildUrl();
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = ws;

    ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.setStatus('open');
    });

    ws.addEventListener('message', (event) => {
      let frame: IRealtimeFrame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      const key = `${frame.channel}:${frame.type}`;
      const set = this.handlers.get(key);
      if (!set) return;
      for (const handler of set) handler(frame.payload);
    });

    ws.addEventListener('close', (event) => {
      this.socket = null;
      this.setStatus('closed');
      // 4401 = server-side auth rejection. Don't retry — user needs to log in.
      if (event.code === 4401 || this.explicitlyClosed) return;
      this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // Let the 'close' handler decide whether to reconnect.
    });
  }

  private buildUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${WS_PATH}`;
  }

  private scheduleReconnect(): void {
    if (this.explicitlyClosed) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      // Wait for the browser to report we're back online — handleBrowserOnline
      // will call openSocket(). No timer in this branch.
      return;
    }
    const delay = Math.min(
      INITIAL_BACKOFF_MS * 2 ** this.reconnectAttempts,
      MAX_BACKOFF_MS,
    );
    this.reconnectAttempts += 1;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleBrowserOnline = (): void => {
    if (this.explicitlyClosed) return;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    this.openSocket();
  };

  private setStatus(status: IRealtimeStatus): void {
    if (status === this.status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

export const realtime = new RealtimeClient();
