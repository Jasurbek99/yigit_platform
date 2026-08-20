import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import AppLayout from './AppLayout';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/uiStore';
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
    // Required on ICurrentUser since the season-lifecycle work. Neither
    // affects which menu composition is selected — that turns on role alone.
    active_season: null,
    can_view_closed_seasons: false,
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

// The exact 46 route keys BOSS_MENU_GROUPS produces, in group + item order,
// transcribed from AppLayout.tsx. Exists so a future edit to the boss
// composition (its whole reason for staying untouched by this refactor) has
// a hard failure to trip, not just "still non-empty".
const EXPECTED_BOSS_ORDERED_KEYS = [
  '/', '/boss/dashboard', '/me/board', '/director/stuck-shipments',
  '/export/plan', '/export/harvest-board', '/export/trucks', '/export/quota', '/export/blocks',
  '/export/weightmaster',
  '/export/shipments', '/export/shipments/sheet', '/export/shipments/board', '/export/shipments/dashboard',
  '/transport/map',
  '/documents', '/admin/packing-templates',
  '/contracts', '/sales', '/export/my-reports', '/export/domestic-sales', '/export/prices',
  '/export/advances', '/export/overdue', '/admin/expense-template',
  '/analytics/clients-report', '/team/kpi', '/worklog',
  '/admin/seasons', '/admin/firms', '/admin/import-firms', '/admin/customers', '/admin/blocks', '/admin/truck-destinations', '/admin/fleet',
  '/admin/users', '/admin/permissions', '/admin/staff-access', '/admin/shipment-settings', '/admin/sales-rep-coverage', '/admin/audit-log', '/admin/process-links',
  '/feedback/submit', '/feedback/my-tickets', '/feedback/public', '/admin/feedback',
];

// The exact 48 route keys STAFF_MENU_GROUPS produces, in group + item order,
// transcribed directly from STAFF_MENU_GROUPS in AppLayout.tsx (not from the
// task brief). Symmetric to EXPECTED_BOSS_ORDERED_KEYS above: an ordered
// per-composition check is the only guard that catches an item landing in
// the wrong group while the overall label list and the unordered 47-key set
// both stay correct (e.g. moving /me/board into nav.group_main while moving
// something else out of it to keep group_export's count at 15).
const EXPECTED_STAFF_ORDERED_KEYS = [
  '/', '/boss/dashboard', '/director/stuck-shipments',
  '/analytics/clients-report', '/export/blocks',
  '/export/shipments/dashboard', '/export/shipments', '/export/shipments/sheet', '/me/board',
  '/export/shipments/board', '/export/harvest-board', '/export/weightmaster', '/export/overdue',
  '/export/my-reports', '/export/advances', '/transport/map',
  '/export/trucks', '/export/drafts', '/export/assign', '/export/domestic-sales', '/export/prices',
  '/contracts', '/sales', '/documents',
  '/export/plan', '/export/quota', '/admin/seasons', '/admin/firms', '/admin/import-firms', '/admin/customers', '/admin/blocks',
  '/admin/users', '/admin/truck-destinations', '/admin/fleet', '/admin/shipment-settings', '/admin/permissions', '/admin/staff-access', '/admin/sales-rep-coverage', '/admin/expense-template', '/admin/packing-templates', '/admin/audit-log', '/admin/process-links',
  '/worklog', '/team/kpi',
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

  it('boss menu renders exactly the expected 46 route keys, in order', () => {
    renderLayout(fakeUser({ role: 'boss' as UserRole }));
    expect(renderedMenuItemKeys()).toEqual(EXPECTED_BOSS_ORDERED_KEYS);
  });

  it('staff menu renders exactly the expected 48 route keys, in order', () => {
    renderLayout(fakeUser({ role: 'export_manager' as UserRole }));
    expect(renderedMenuItemKeys()).toEqual(EXPECTED_STAFF_ORDERED_KEYS);
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

  it('staff reaches all 48 route keys; the boss reaches the same set minus the two pages withheld from his sidebar', () => {
    renderLayout(fakeUser({ role: 'boss' as UserRole }));
    const bossKeys = renderedMenuItemKeys();
    cleanup();

    renderLayout(fakeUser({ role: 'export_manager' as UserRole }));
    const staffKeys = renderedMenuItemKeys();

    // The two compositions were key-for-key identical until 2026-08-20, when the
    // owner asked for Draft Shipments and Assignment Board to be dropped from the
    // boss sidebar. They stay in the staff menu — they are working pages for
    // export_manager / loading_dept_head — so the sets now differ by exactly those
    // two keys, and by nothing else.
    const WITHHELD_FROM_BOSS = ['/export/drafts', '/export/assign'];

    expect(bossKeys).toHaveLength(46);
    expect(staffKeys).toHaveLength(48);
    for (const key of WITHHELD_FROM_BOSS) {
      expect(staffKeys).toContain(key);
      expect(bossKeys).not.toContain(key);
    }
    expect(new Set(staffKeys.filter((k) => !WITHHELD_FROM_BOSS.includes(k)))).toEqual(
      new Set(bossKeys),
    );
  });
});

// Logout teardown lives here rather than in its own file so it can reuse the
// mock scaffolding above — AppLayout pulls in enough machinery that a second
// copy would be worse than the slightly broader file name.
describe('AppLayout logout teardown', () => {
  it('resets the boss view/edit toggle, so the next login on this tab starts in view mode', async () => {
    useUiStore.setState({ bossEditMode: true });
    renderLayout(fakeUser({ role: 'boss' as UserRole }));

    await userEvent.click(screen.getByRole('button', { name: i18n.t('nav.sign_out') }));

    // Logout is an SPA transition, not a reload: nothing clears the module-level
    // store on its own. Without the explicit reset the next boss to sign in on
    // this tab lands in Edit mode, past the confirmation dialog.
    await waitFor(() => expect(useUiStore.getState().bossEditMode).toBe(false));
  });
});
