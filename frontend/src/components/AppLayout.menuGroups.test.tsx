import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// The "does a boss get the boss composition / a non-boss get the staff
// composition" question is tested directly against the pure selector in
// utils/menuComposition.test.ts — that test exercises the exact mechanism
// AppLayout calls (pickMenuComposition) and would fail if the branches were
// ever swapped. This file is left to verify what a full render actually
// produces: a non-empty menu with no duplicate route keys, for either role.
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
});
