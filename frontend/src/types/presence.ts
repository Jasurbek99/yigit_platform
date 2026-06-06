// Realtime / presence types — mirror the server envelope so the WS client
// stays one source of truth and the consumer dispatch table is type-checked.

export type IRealtimeStatus = 'connecting' | 'open' | 'closed';

export interface IPresenceUser {
  user_id: number;
  username: string;
  name: string;
  role: string;
  /** Deterministic per-user colour from the backend palette. */
  color: string;
  /** ISO-8601, set when the user joined. */
  joined_at: string;
}

/** Envelope every frame uses (client → server and server → client). */
export interface IRealtimeFrame<TPayload = unknown> {
  channel: string;
  type: string;
  payload?: TPayload;
}

/** Server → client: `presence.sheet` roster broadcast. */
export interface IPresenceRosterPayload {
  users: IPresenceUser[];
}
