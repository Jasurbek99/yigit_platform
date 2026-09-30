import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import i18n from '@/i18n';
import { GateTaskCard } from './GateTaskCard';
import { useGateAction } from '@/hooks/useGate';
import { useAuth } from '@/hooks/useAuth';
import { useUiStore } from '@/stores/uiStore';
import type { ITaskListItem } from '@/types';

vi.mock('@/hooks/useGate', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useGate')>()),
  useGateAction: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));

const mutate = vi.fn();

function task(overrides: Partial<ITaskListItem> = {}): ITaskListItem {
  return {
    id: 10, shipment: 7, shipment_code: '0000007/26', kind: 'gate', link: '/export/gate',
    scope_year: null, scope_week: null, scope_block: null, scope_block_code: null,
    scope_location: 3, truck_plate: '1535AKM', step: 'gate_arrive', phase: 'DOCS',
    title_key: 'tasks.gate_arrive', assignee_role: 'garawul', assignee_user: null,
    assignee_user_name: null, target_fields_list: [], completion_rule: 'manual_done',
    deadline: null, deadline_rule: '', state: 'open', is_overdue: false,
    created_at: '2026-09-29T08:00:00Z', started_at: null, completed_at: null, blocked_reason: '',
    ...overrides,
  } as ITaskListItem;
}

const GATE_EDIT = { gate: { view: true, create: true, edit: true, delete: true } };

function setup(t: ITaskListItem, role = 'garawul', resource_permissions: object = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: { role, is_superuser: false, resource_permissions },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useGateAction).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useGateAction>);
  return render(<GateTaskCard task={t} />);
}

describe('GateTaskCard', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ bossEditMode: false });
  });

  it('shows the plate and marks arrival after a confirm', () => {
    // A real garawul always holds resource_permissions.gate.edit (seeded by
    // core/0067) — canDo needs it explicitly now that it replaced the
    // hand-built isGuard shortcut (final-fix review F9).
    setup(task(), 'garawul', GATE_EDIT);
    expect(screen.getByText('Truck 1535AKM is due — mark arrival')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Arrived at greenhouse' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Yes, confirm' }));
    expect(mutate).toHaveBeenCalledWith({ id: 7, action: 'arrive', locationId: null }, expect.any(Object));
  });

  it('an exit task marks departure; a supervisor sends the task location', () => {
    setup(task({ step: 'gate_depart', title_key: 'tasks.gate_depart' }), 'admin', GATE_EDIT);
    fireEvent.click(screen.getByRole('button', { name: 'Left greenhouse' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Yes, confirm' }));
    expect(mutate).toHaveBeenCalledWith({ id: 7, action: 'depart', locationId: 3 }, expect.any(Object));
  });

  it('a done task has no button', () => {
    setup(task({ state: 'done' }));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a supervisor without the gate grant sees the card but no button', () => {
    // export_manager / director see every role's tasks on My Tasks but hold no
    // `gate` resource (Task 2) — the button would only 403.
    setup(task(), 'export_manager');
    expect(screen.getByText('Truck 1535AKM is due — mark arrival')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a boss in view mode sees the card but no button', () => {
    // boss holds the gate grant by policy, but canDo blocks any non-view
    // action while the header toggle is off (final-fix review F9).
    useUiStore.setState({ bossEditMode: false });
    setup(task(), 'boss', GATE_EDIT);
    expect(screen.getByText('Truck 1535AKM is due — mark arrival')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a boss who switched to edit mode sees the button', () => {
    useUiStore.setState({ bossEditMode: true });
    setup(task(), 'boss', GATE_EDIT);
    expect(screen.getByRole('button', { name: 'Arrived at greenhouse' })).toBeInTheDocument();
  });
});
