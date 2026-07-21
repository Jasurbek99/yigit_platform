import { describe, it, expect } from 'vitest';
import { groupCommentCountsByField } from './useShipmentComments';
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
