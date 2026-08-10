import { useRef } from 'react';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * crypto.randomUUID() only exists in a secure context. Beta serves over plain
 * HTTP at 10.10.11.25:8080, where it is undefined — without this fallback
 * idempotency would be silently dead on the one server where it gets tested.
 */
function newKey(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface IIdempotencyKey {
  key: string;
  reset: () => void;
}

/**
 * A key that survives re-renders, so pressing Save again after a timeout
 * reuses it and the server replays the original response instead of creating
 * a second record.
 *
 * Call one instance PER MUTATION. Sharing an instance between two different
 * mutations that POST to the same path makes the second one silently receive
 * the first one's response and never create its own record.
 */
export function useIdempotencyKey(): IIdempotencyKey {
  const ref = useRef<string>(newKey());
  return {
    key: ref.current,
    reset: (): void => {
      ref.current = newKey();
    },
  };
}
