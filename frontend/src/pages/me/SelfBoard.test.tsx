import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import SelfBoard from './SelfBoard';

const authState: { user: { role: string; is_superuser: boolean; username: string } | null } = {
  user: null,
};
const useMyTasksMock = vi.fn((_opts?: { role?: string | null; scope?: string }) => ({
  data: { results: [] }, isLoading: false, isError: false,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('@/hooks/useMyTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useMyTasks')>()),
  useMyTasks: (opts: { role?: string | null; scope?: string }) => useMyTasksMock(opts),
}));
vi.mock('@/hooks/useMyKpiToday', () => ({
  useMyKpiToday: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('@/hooks/useTaskActions', () => ({
  useBlockTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUnblockTask: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/components/kanban/SelfBoardTaskDrawer', () => ({ SelfBoardTaskDrawer: () => null }));

function lastRole(): string | null | undefined {
  const { calls } = useMyTasksMock.mock;
  return calls[calls.length - 1]?.[0]?.role;
}

function lastScope(): string | undefined {
  const { calls } = useMyTasksMock.mock;
  return calls[calls.length - 1]?.[0]?.scope;
}

function renderAs(role: string) {
  authState.user = { role, is_superuser: false, username: role };
  return render(<MemoryRouter><SelfBoard /></MemoryRouter>);
}

describe('SelfBoard role filter', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { useMyTasksMock.mockClear(); });

  it('opens an export_manager on its own tasks', () => {
    renderAs('export_manager');
    expect(lastRole()).toBe('export_manager');
  });

  it('keeps boss on every role by default', () => {
    renderAs('boss');
    expect(lastRole()).toBeNull();
    expect(screen.getByText('All roles')).toBeInTheDocument();
  });

  it('lets an export_manager widen to all roles', async () => {
    renderAs('export_manager');
    // The role switcher is the first Select on the filter row.
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    const option = await waitFor(() => {
      const el = document.querySelector('.ant-select-item-option[title="All roles"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.click(option);
    await waitFor(() => expect(lastRole()).toBeNull());
  });
});

describe('SelfBoard colleagues tab', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { useMyTasksMock.mockClear(); });

  it('regular role opens on its own tasks', () => {
    renderAs('loading_dept_head');
    expect(lastScope()).toBe('mine');
    expect(screen.getByText("Colleagues' tasks")).toBeInTheDocument();
  });

  it('switching the tab requests colleagues scope', () => {
    renderAs('loading_dept_head');
    // Segmented listens on its radio input, not the label text.
    fireEvent.click(screen.getByRole('radio', { name: "Colleagues' tasks" }));
    expect(lastScope()).toBe('colleagues');
  });

  it('supervisors get no colleagues tab', () => {
    renderAs('boss');
    expect(screen.queryByText("Colleagues' tasks")).toBeNull();
  });
});
