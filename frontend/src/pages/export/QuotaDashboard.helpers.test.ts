import { describe, it, expect } from 'vitest';
import { quotaPanelAccess, seasonsVisibleTo } from './QuotaDashboard.helpers';
import { canSeePage } from '@/utils/permissions';
import type { ICurrentUser, ISeason, SeasonStatus, UserRole } from '@/types';

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

// ─── quotaPanelAccess ────────────────────────────────────────────────────────
// Permission fixtures mirror the LIVE matrix, read off /auth/me/ per role on
// 2026-08-23 — not seed_permissions.py's defaults, which the DB may have
// diverged from. Notably: NO role holds `quota_usage` without
// `quota_issuance`, which is why one `canSeeQuota` flag covers both tabs.

function user(
  role: UserRole,
  pages: string[],
  resources: string[],
): ICurrentUser {
  return {
    id: 1,
    username: role,
    email: '',
    first_name: '',
    last_name: '',
    role,
    is_superuser: false,
    managed_block_ids: [],
    permissions: [],
    page_permissions: Object.fromEntries(pages.map((p) => [p, true])),
    resource_permissions: Object.fromEntries(
      resources.map((r) => [r, { view: true, create: true, edit: true, delete: false }]),
    ),
    field_permissions: {},
    active_season: { id: 3, name: '2026-2027', status: 'ACTIVE' },
    can_view_closed_seasons: false,
  };
}

const SELLER = user('seller', ['export.quota.local_sell'], ['local_sell_plan']);
const EXPORT_MANAGER = user(
  'export_manager',
  ['export.quota', 'export.quota.local_sell'],
  ['quota_issuance', 'quota_usage', 'local_sell_plan'],
);
const DOCUMENT_TEAM = user(
  'document_team',
  ['export.quota', 'export.quota.local_sell'],
  ['quota_issuance', 'quota_usage'],
);
const LOADING_DEPT_HEAD = user(
  'loading_dept_head',
  ['export.quota', 'export.quota.local_sell'],
  ['quota_issuance', 'quota_usage'],
);

describe('quotaPanelAccess', () => {
  it('gives the seller the sell plan and nothing else', () => {
    expect(quotaPanelAccess(SELLER)).toEqual({
      canSeeQuota: false,
      canSeeLocalSell: true,
      canSeeAnalytics: false,
    });
  });

  it('does not let the export.quota.local_sell child page imply quota access', () => {
    // Regression: canSeePage() treats any child page as access to the parent,
    // so canSeePage(seller, 'export.quota') is TRUE — which enabled a
    // /quota-dashboard/ query the backend 403s, painting an error banner.
    expect(canSeePage(SELLER, 'export.quota')).toBe(true);
    expect(quotaPanelAccess(SELLER).canSeeQuota).toBe(false);
  });

  it('gives export_manager everything', () => {
    expect(quotaPanelAccess(EXPORT_MANAGER)).toEqual({
      canSeeQuota: true,
      canSeeLocalSell: true,
      canSeeAnalytics: true,
    });
  });

  it('keeps the comparison charts from document_team, which holds no sell plan', () => {
    expect(quotaPanelAccess(DOCUMENT_TEAM)).toEqual({
      canSeeQuota: true,
      canSeeLocalSell: true,
      canSeeAnalytics: false,
    });
  });

  it('leaves loading_dept_head unchanged — quota tabs, read-only sell plan', () => {
    expect(quotaPanelAccess(LOADING_DEPT_HEAD)).toEqual({
      canSeeQuota: true,
      canSeeLocalSell: true,
      canSeeAnalytics: false,
    });
  });

  it('denies everything to a logged-out user', () => {
    expect(quotaPanelAccess(null)).toEqual({
      canSeeQuota: false,
      canSeeLocalSell: false,
      canSeeAnalytics: false,
    });
  });
});
