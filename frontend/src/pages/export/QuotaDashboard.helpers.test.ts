import { describe, it, expect } from 'vitest';
import { seasonsVisibleTo } from './QuotaDashboard.helpers';
import type { ISeason, SeasonStatus } from '@/types';

function season(id: number, status: SeasonStatus): ISeason {
  return {
    id,
    name: `s${id}`,
    start_date: '2025-09-01',
    end_date: '2026-06-30',
    is_active: status === 'ACTIVE',
    status,
    closed_at: status === 'CLOSED' ? '2026-07-01T00:00:00Z' : null,
    closed_by: null,
    closed_by_name: null,
  };
}

const SEASONS: ISeason[] = [season(1, 'CLOSED'), season(2, 'ACTIVE'), season(3, 'UPCOMING')];

describe('seasonsVisibleTo', () => {
  it('hides closed seasons from a user without closed_season.can_view', () => {
    expect(seasonsVisibleTo(SEASONS, false).map((s) => s.id)).toEqual([2, 3]);
  });

  it('keeps closed seasons for a user who may browse them', () => {
    expect(seasonsVisibleTo(SEASONS, true).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('keeps upcoming seasons either way — they carry no permission gate', () => {
    expect(seasonsVisibleTo(SEASONS, false).some((s) => s.status === 'UPCOMING')).toBe(true);
  });
});
