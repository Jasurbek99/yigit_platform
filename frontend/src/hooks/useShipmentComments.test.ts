import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { groupCommentCountsByField, useShipmentComments } from './useShipmentComments';
import { useSheetStore } from '@/stores/sheetStore';
import type { IShipmentComment } from '@/types';

let nextId = 1;

function comment(overrides: Partial<IShipmentComment> = {}): IShipmentComment {
  return {
    id: nextId++,
    user_name: 'Ahmet',
    role: 'export_manager',
    content: 'note',
    field_key: null,
    parent_comment: null,
    is_system: false,
    is_deleted: false,
    assignee: null,
    assignee_name: null,
    is_done: false,
    done_at: null,
    done_by_name: null,
    mentions_users: [],
    role_mentions_list: [],
    replies_count: 0,
    created_at: '2026-07-20T10:00:00+05:00',
    updated_at: null,
    ...overrides,
  };
}

describe('groupCommentCountsByField', () => {
  it('groups counts by field_key', () => {
    const comments = [
      comment({ field_key: 'weight_net' }),
      comment({ field_key: 'weight_net' }),
      comment({ field_key: 'vehicle_condition' }),
    ];
    expect(groupCommentCountsByField(comments)).toEqual({
      weight_net: 2,
      vehicle_condition: 1,
    });
  });

  it('excludes is_deleted comments from the count', () => {
    const comments = [
      comment({ field_key: 'weight_net' }),
      comment({ field_key: 'weight_net', is_deleted: true }),
    ];
    expect(groupCommentCountsByField(comments)).toEqual({ weight_net: 1 });
  });

  it('excludes whole-shipment comments (null field_key) from any bucket', () => {
    const comments = [
      comment({ field_key: null }),
      comment({ field_key: 'weight_net' }),
    ];
    expect(groupCommentCountsByField(comments)).toEqual({ weight_net: 1 });
  });

  it('returns an empty object for an empty comment list', () => {
    expect(groupCommentCountsByField([])).toEqual({});
  });
});

// A Sheet cell selection already in the store, pointed at a different
// shipment (999) than the one the hook below mounts for (1).
const STALE_CONTEXT = {
  activeCell: { shipmentId: 999, rowKey: 'weight_net' },
  commentsShipmentId: 999,
  commentsFilter: { fieldKey: 'weight_net' },
  commentsDrawerOpen: false,
} as const;

describe('useShipmentComments — unmount reset gating (regression: closed-drawer detour)', () => {
  beforeEach(() => {
    useSheetStore.setState({ ...STALE_CONTEXT });
  });

  afterEach(() => {
    useSheetStore.setState({
      activeCell: null,
      commentsShipmentId: null,
      commentsFilter: {},
      commentsDrawerOpen: false,
    });
  });

  it('leaves the store untouched when unmounted without ever opening the drawer', () => {
    // Simulates: Sheet has a cell selected (activeCell/commentsShipmentId set),
    // user clicks a shipment-code link into Detail, never touches comments,
    // then navigates back — mount + unmount only.
    const { unmount } = renderHook(() => useShipmentComments(1, []));

    unmount();

    const state = useSheetStore.getState();
    expect(state.activeCell).toEqual(STALE_CONTEXT.activeCell);
    expect(state.commentsShipmentId).toBe(STALE_CONTEXT.commentsShipmentId);
    expect(state.commentsFilter).toEqual(STALE_CONTEXT.commentsFilter);
  });

  it('resets the store after the drawer is opened then explicitly closed', () => {
    const { result } = renderHook(() => useShipmentComments(1, []));

    act(() => result.current.open('weight_net'));
    expect(useSheetStore.getState().commentsShipmentId).toBe(1);

    act(() => result.current.close());

    const state = useSheetStore.getState();
    expect(state.activeCell).toBeNull();
    expect(state.commentsShipmentId).toBeNull();
    expect(state.commentsFilter).toEqual({});
  });

  it('resets the store on unmount if the drawer was opened but never explicitly closed', () => {
    const { result, unmount } = renderHook(() => useShipmentComments(1, []));

    act(() => result.current.open('weight_net'));
    expect(useSheetStore.getState().commentsShipmentId).toBe(1);

    unmount();

    const state = useSheetStore.getState();
    expect(state.activeCell).toBeNull();
    expect(state.commentsShipmentId).toBeNull();
    expect(state.commentsFilter).toEqual({});
  });
});
