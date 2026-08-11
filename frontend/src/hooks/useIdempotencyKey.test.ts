import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useIdempotencyKey } from './useIdempotencyKey';

describe('useIdempotencyKey', () => {
  it('keeps the same key across re-renders', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;
    rerender();
    rerender();
    expect(result.current.key).toBe(first);
  });

  it('issues a new key after reset', () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;
    act(() => result.current.reset());
    rerender();
    expect(result.current.key).not.toBe(first);
  });

  it('gives separate hook instances separate keys', () => {
    const a = renderHook(() => useIdempotencyKey());
    const b = renderHook(() => useIdempotencyKey());
    expect(a.result.current.key).not.toBe(b.result.current.key);
  });

  it('produces a key the backend regex accepts', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    expect(result.current.key).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('works without crypto.randomUUID (plain-HTTP beta)', () => {
    const original = globalThis.crypto.randomUUID;
    // Beta serves over plain HTTP, where randomUUID is undefined.
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
    try {
      const { result } = renderHook(() => useIdempotencyKey());
      expect(result.current.key).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: original,
        configurable: true,
      });
    }
  });
});
