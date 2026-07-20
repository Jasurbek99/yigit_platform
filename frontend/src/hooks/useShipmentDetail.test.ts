import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { getShipmentDetailKey } from './useShipmentDetail';

/**
 * Regression: the /me/board task drawer passes `task.shipment` (a NUMBER) to
 * useShipmentDetail, while every mutation invalidates ['shipment', String(id)].
 * TanStack compares key parts type-strictly, so 42 !== '42' — the invalidation
 * missed, the detail cache stayed stale, and the drawer's progress bar only
 * moved after close + reopen (remount refetch).
 */
describe('getShipmentDetailKey', () => {
  it('normalises a numeric id to the string form used by every invalidation site', () => {
    expect(getShipmentDetailKey(42)).toEqual(['shipment', '42']);
  });

  it('leaves a string id untouched', () => {
    expect(getShipmentDetailKey('42')).toEqual(['shipment', '42']);
  });

  it('preserves undefined so the query stays disabled', () => {
    expect(getShipmentDetailKey(undefined)).toEqual(['shipment', undefined]);
  });

  it('is invalidated by a String(id) invalidation when the caller passed a number', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(getShipmentDetailKey(42), { id: 42 });

    void queryClient.invalidateQueries({ queryKey: ['shipment', String(42)] });

    const state = queryClient.getQueryState(getShipmentDetailKey(42));
    expect(state?.isInvalidated).toBe(true);
  });

  it('documents the old bug: a raw numeric key is NOT matched by String(id)', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['shipment', 42], { id: 42 });

    void queryClient.invalidateQueries({ queryKey: ['shipment', String(42)] });

    expect(queryClient.getQueryState(['shipment', 42])?.isInvalidated).toBe(false);
  });
});
