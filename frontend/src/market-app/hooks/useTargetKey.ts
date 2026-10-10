import { useRef } from 'react';
import { newIdempotencyKey } from '@/hooks/useIdempotencyKey';

export interface ITargetKey {
  /** The key for a request about `target`; a new one when the target changes. */
  keyFor: (target: string) => string;
  reset: () => void;
}

/**
 * An Idempotency-Key for writes aimed at different things through one endpoint
 * (open truck A, then truck B; buyer «Рустам», then «Ахмед»): a lost answer for A
 * must not be replayed for B, while a retry of A reuses the key of A.
 */
export function useTargetKey(): ITargetKey {
  const ref = useRef<{ target: string; key: string } | null>(null);
  return {
    keyFor: (target: string): string => {
      if (ref.current?.target !== target) ref.current = { target, key: newIdempotencyKey() };
      return ref.current.key;
    },
    reset: (): void => {
      ref.current = null;
    },
  };
}
