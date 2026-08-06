import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import AppLayout from './AppLayout';
import { useAuth } from '@/hooks/useAuth';
import type { ICurrentUser, UserRole } from '@/types';

// AppLayout pulls in a wide surface of unrelated hooks/components (worklog
// heartbeat, realtime socket, notifications, feedback FAB, process tour).
// None of that machinery affects which menu composition is selected, so it
// is stubbed out here rather than exercised — mounting the whole app shell
// for real would make this test fragile against changes that have nothing
// to do with the boss/staff menu seam.
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useFeedback', () => ({
  useFeedbackAdminUnreadCount: () => ({ data: 0 }),
}));
vi.mock('@/hooks/useMyTasks', () => ({
  useMyTasks: () => ({ data: { results: [] } }),
}));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => undefined }));
vi.mock('@/hooks/useWorklogHeartbeat', () => ({ useWorklogHeartbeat: () => undefined }));
vi.mock('@/hooks/useProcessTour', () => ({ useProcessTour: () => vi.fn() }));
vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('@/components/WorklogChip', () => ({ WorklogChip: () => null }));
vi.mock('@/components/feedback/FeedbackFAB', () => ({ FeedbackFAB: () => null }));
vi.mock('@/services/api', () => ({
  default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

function fakeUser(overrides: Partial<ICurrentUser> = {}): ICurrentUser {
  return {
    id: 1,
    username: 'user',
    email: '',
    first_name: '',
    last_name: '',
    role: 'export_manager' as UserRole,
    is_superuser: true, // bypass page_permissions — irrelevant to menu composition selection
    managed_block_ids: [],
    permissions: ['*'],
    page_permissions: {},
    resource_permissions: {},
    field_permissions: {},
    ...overrides,
  };
}

function renderLayout(user: ICurrentUser) {
  vi.mocked(useAuth).mockReturnValue({ user, isLoading: false, isError: false });
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <AppLayout />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Route keys of every rendered `<li class="ant-menu-item">` in DOM order. */
function renderedMenuItemKeys(): string[] {
  return Array.from(document.querySelectorAll('li.ant-menu-item[data-menu-id]')).map((el) => {
    const raw = el.getAttribute('data-menu-id') ?? '';
    // antd prefixes data-menu-id with an internal menu instance id, e.g.
    // "rc-menu-uuid-xxx-/export/shipments" — the route key is the part
    // after the last "-" run preceding the leading "/".
    const match = raw.match(/(\/.*)$/);
    return match ? match[1] : raw;
  });
}

/** Text of every rendered menu group title, in DOM order. */
function renderedMenuGroupLabels(): string[] {
  return Array.from(document.querySelectorAll('.ant-menu-item-group-title')).map(
    (el) => el.textContent ?? '',
  );
}

// The exact 45 route keys BOSS_MENU_GROUPS produces, in group + item order,
// transcribed from AppLayout.tsx. Exists so a future edit to the boss
// composition (its whole reason for staying untouched by this refactor) has
// a hard failure to trip, not just "still non-empty".
const EXPECTED_BOSS_ORDERED_KEYS = [
  '/', '/boss/dashboard', '/me/board', '/director/stuck-shipments',
  '/export/plan', '/export/harvest-board', '/export/trucks', '/export/quota', '/export/blocks',
  '/export/drafts', '/export/assign', '/export/weightmaster',
  '/export/shipments', '/export/shipments/sheet', '/export/shipments/board', '/export/shipments/dashboard',
  '/documents', '/admin/packing-templates',
  '/contracts', '/sales', '/export/my-reports', '/export/domestic-sales', '/export/prices',
  '/export/advances', '/export/overdue', '/admin/expense-template',
  '/analytics/clients-report', '/team/kpi', '/worklog',
  '/admin/seasons', '/admin/firms', '/admin/import-firms', '/admin/customers', '/admin/blocks', '/admin/truck-destinations',
  '/admin/users', '/admin/permissions', '/admin/staff-access', '/admin/shipment-settings', '/admin/sales-rep-coverage', '/admin/audit-log',
  '/feedback/submit', '/feedback/my-tickets', '/feedback/public', '/admin/feedback',
];

// All 11 boss group labels / all 8 staff group labels, in render order —
// three keys (group_analytics, group_system, group_feedback) are shared by
// both compositions with different membership, so they appear in both lists.
const ALL_BOSS_GROUP_LABEL_KEYS = [
  'nav.group_overview', 'nav.group_planning', 'nav.group_prep', 'nav.group_shipping',
  'nav.group_docs', 'nav.group_sales', 'nav.group_finance', 'nav.group_analytics',
  'nav.group_reference', 'nav.group_system', 'nav.group_feedback',
];
const ALL_STAFF_GROUP_LABEL_KEYS = [
  'nav.group_main', 'nav.group_analytics', 'nav.group_export', 'nav.group_contracts',
  'nav.group_management', 'nav.group_system', 'nav.group_team', 'nav.group_feedback',
];

// The subset of each composition's group labels that is NOT shared with the
// other — used only for the disjoint ("present in one, absent from the
// other") check below.
const BOSS_ONLY_GROUP_LABEL_KEYS = [
  'nav.group_overview', 'nav.group_planning', 'nav.group_prep', 'nav.group_shipping',
  'nav.group_docs', 'nav.group_sales', 'nav.group_finance', 'nav.group_reference',
];
const STAFF_ONLY_GROUP_LABEL_KEYS = [
  'nav.group_main', 'nav.group_export', 'nav.group_contracts', 'nav.group_management', 'nav.group_team',
];

// The "does a boss get the boss composition / a non-boss get the staff
// composition" question is tested directly against the pure selector in
// utils/menuComposition.test.ts — that test exercises the exact mechanism
// AppLayout calls (pickMenuComposition) and would fail if the branches were
// ever swapped. This file is left to verify what a full render actually
// produces: a non-empty menu with no duplicate route keys, for either role,
// and — now that the two compositions genuinely differ — that they differ
// in the specific structural way intended (module grouping vs. process
// grouping) rather than by accident.
describe('AppLayout menu composition', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders a non-empty boss menu with no duplicate route keys', () => {
    renderLayout(fakeUser({ role: 'boss' as UserRole }));
    const keys = renderedMenuItemKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('renders a non-empty staff menu with no duplicate route keys', () => {
    renderLayout(fakeUser({ role: 'export_manager' as UserRole }));
    const keys = renderedMenuItemKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('smoke: the dashboard nav label renders for a boss user', () => {
    renderLayout(fakeUser({ role: 'boss' as UserRole }));
    // The label also appears in the header breadcrumb, so assert presence
    // via getAllByText rather than the single-match getByText.
    expect(screen.getAllByText(i18n.t('nav.dashboard')).length).toBeGreaterThan(0);
  });

  it('boss menu renders exactly the process-phase groups; staff menu renders exactly the old module groups', () => {
    renderLayout(fakeUser({ role: 'boss' as UserRole }));
    const bossLabels = renderedMenuGroupLabels();
    cleanup();

    renderLayout(fakeUser({ role: 'export_manager' as UserRole }));
    const staffLabels = renderedMenuGroupLabels();

    expect(bossLabels).toEqual(ALL_BOSS_GROUP_LABEL_KEYS.map((key) => i18n.t(key)));
    expect(staffLabels).toEqual(ALL_STAFF_GROUP_LABEL_KEYS.map((key) => i18n.t(key)));

    // The genuinely-differ assertion this whole refactor exists for: a
    // group label unique to one composition must be absent from the other.
    // (nav.group_analytics / group_system / group_feedback are deliberately
    // shared by both compositions with different membership, so they are
    // excluded from this disjoint check by construction — see the boss/
    // staff-only key lists above.)
    for (const key of BOSS_ONLY_GROUP_LABEL_KEYS) {
      expect(staffLabels).not.toContain(i18n.t(key));
    }
    for (const key of STAFF_ONLY_GROUP_LABEL_KEYS) {
      expect(bossLabels).not.toContain(i18n.t(key));
    }
  });

  it('boss menu renders exactly the expected 45 route keys, in order', () => {
    renderLayout(fakeUser({ role: 'boss' as UserRole }));
    expect(renderedMenuItemKeys()).toEqual(EXPECTED_BOSS_ORDERED_KEYS);
  });

  it('every route key rendered by either composition is a real ITEMS-backed menu item (no stray "undefined" labels)', () => {
    renderLayout(fakeUser({ role: 'boss' as UserRole }));
    for (const el of Array.from(document.querySelectorAll('li.ant-menu-item'))) {
      expect(el.textContent).not.toBe('');
      expect(el.textContent).not.toMatch(/undefined/);
    }
    cleanup();

    renderLayout(fakeUser({ role: 'export_manager' as UserRole }));
    for (const el of Array.from(document.querySelectorAll('li.ant-menu-item'))) {
      expect(el.textContent).not.toBe('');
      expect(el.textContent).not.toMatch(/undefined/);
    }
  });

  it('boss and staff compositions reach the same set of 45 route keys — grouping differs, reachable pages do not', () => {
    renderLayout(fakeUser({ role: 'boss' as UserRole }));
    const bossKeys = renderedMenuItemKeys();
    cleanup();

    renderLayout(fakeUser({ role: 'export_manager' as UserRole }));
    const staffKeys = renderedMenuItemKeys();

    expect(bossKeys).toHaveLength(45);
    expect(staffKeys).toHaveLength(45);
    expect(new Set(staffKeys)).toEqual(new Set(bossKeys));
  });
});
