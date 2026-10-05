import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import i18n from '@/i18n';
import TaskRulesPage from './TaskRulesPage';
import { useSetTaskRuleAssignees, useTaskRuleCandidates, useTaskRules } from '@/hooks/useTaskRules';
import type { ITaskRule } from '@/types';

const authState: { user: { role: string; is_superuser: boolean } | null } = {
  user: { role: 'admin', is_superuser: false },
};

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('@/hooks/useTaskRules', () => ({
  useTaskRules: vi.fn(),
  useTaskRuleCandidates: vi.fn(() => ({ data: [], isLoading: false })),
  useSetTaskRuleAssignees: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

function rule(overrides: Partial<ITaskRule> = {}): ITaskRule {
  return {
    id: 1,
    step: 'draft',
    step_display: 'Preparation',
    step_order: 0,
    step_phase: 'DRAFT',
    title_key: 'tasks.set_destination',
    assignee_role: 'export_manager',
    assignee_role_display: 'Export Manager',
    target_fields: ['country', 'customer'],
    completion_rule: 'all_fields_filled',
    completion_rule_display: 'All target fields filled',
    target_value: '',
    deadline_rule: '24h_after_status',
    condition_field: '',
    condition_value: '',
    is_active: true,
    depends_on: [],
    gates_step: true,
    assignees: [],
    ...overrides,
  };
}

function renderPage(rules: ITaskRule[], state: Partial<{ isLoading: boolean; isError: boolean }> = {}) {
  vi.mocked(useTaskRules).mockReturnValue({
    data: rules,
    isLoading: false,
    isError: false,
    ...state,
  } as ReturnType<typeof useTaskRules>);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><TaskRulesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TaskRulesPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('explains what triggers a task before listing any rule', () => {
    renderPage([rule()]);

    // The page's job is the "why", not just the table — the trigger sentence
    // must survive a redesign of the layout around it.
    expect(screen.getByText(/A shipment ENTERS a status/)).toBeInTheDocument();
    expect(screen.getByText(/Mark Done tasks never hold a truck back/)).toBeInTheDocument();
  });

  it('renders a rule row with its step, role and watched fields', () => {
    // A role display unique to this test: "Export Manager" also appears in the
    // code-driven kinds table below the catalog (truck allocation is theirs).
    renderPage([rule({ assignee_role_display: 'Document Team' })]);

    expect(screen.getByText('Preparation')).toBeInTheDocument();
    expect(screen.getByText('Document Team')).toBeInTheDocument();
    expect(screen.getByText('Auto — when fields are filled')).toBeInTheDocument();
    // target_fields arrive as a list and render one tag each.
    expect(screen.getByText('Country')).toBeInTheDocument();
    expect(screen.getByText('Customer')).toBeInTheDocument();
  });

  it('translates the step from its status code, not the English server display', () => {
    // step_display is whatever `ShipmentStatusType.name_en` holds; the page must
    // prefer the locale's own status label so tk/ru users do not read English.
    renderPage([rule({ step: 'yuklenme', step_display: 'yuklenme' })]);

    expect(screen.getByText('Loading Started')).toBeInTheDocument();
  });

  it('falls back to the server display for a retired status code', () => {
    renderPage([rule({ step: 'zzz_retired', step_display: 'zzz_retired', step_order: null })]);

    // Twice: the name line falls back to step_display, and the raw code line
    // under it always shows the code.
    expect(screen.getAllByText('zzz_retired')).toHaveLength(2);
  });

  it('labels watched fields the operator would not recognise by key', () => {
    // These 26 keys are only translated under shipment_edit_drawer.field.*, not
    // tasks.field_label.* — the page must read both or they render snake_case.
    renderPage([rule({ target_fields: ['weight_net', 'shipment_code'] })]);

    expect(screen.getByText('Net weight')).toBeInTheDocument();
    expect(screen.getByText('Shipment Code')).toBeInTheDocument();
  });

  it('marks a Mark Done rule differently from an auto rule', () => {
    renderPage([
      rule({ id: 1 }),
      rule({
        id: 2,
        title_key: 'tasks.give_documents',
        completion_rule: 'manual_done',
        target_fields: [],
      }),
    ]);

    expect(screen.getByText('Auto — when fields are filled')).toBeInTheDocument();
    expect(screen.getByText('Mark Done button')).toBeInTheDocument();
  });

  it('puts the deadline grammar into words', () => {
    renderPage([
      rule({ id: 1, deadline_rule: '24h_after_status' }),
      rule({ id: 2, deadline_rule: '13:00_same_day' }),
      rule({ id: 3, deadline_rule: 'friday_eow' }),
      rule({ id: 4, deadline_rule: '' }),
    ]);

    expect(screen.getByText('24 h after the status change')).toBeInTheDocument();
    expect(screen.getByText('13:00 same day')).toBeInTheDocument();
    expect(screen.getByText('Friday 18:00')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows a rule condition instead of "Always" when the rule is gated', () => {
    renderPage([
      rule({ id: 1 }),
      rule({
        id: 2,
        title_key: 'tasks.give_documents_gapy',
        condition_field: 'is_gapy_satys',
        condition_value: 'True',
      }),
    ]);

    expect(screen.getByText('Always')).toBeInTheDocument();
    // The raw Python repr `True` is rendered as a word, and the field is named.
    expect(screen.getByText(/Is Gapy Satys = Yes/)).toBeInTheDocument();
  });

  it('hides inactive rules until the toggle is switched on', () => {
    renderPage([
      rule({ id: 1, title_key: 'tasks.set_destination' }),
      rule({ id: 2, title_key: 'tasks.give_documents', is_active: false }),
    ]);

    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('surfaces a load failure rather than an empty table', () => {
    renderPage([], { isError: true });

    expect(screen.getByText('Could not load the task rules.')).toBeInTheDocument();
  });

  it('lists the three code-driven kinds with their role and trigger', () => {
    renderPage([rule()]);

    expect(screen.getByText('Fill the weekly harvest plan')).toBeInTheDocument();
    expect(screen.getByText('Fill the local sell plan')).toBeInTheDocument();
    expect(screen.getByText('Fill the truck allocation')).toBeInTheDocument();
    expect(screen.getByText(/Every Saturday 09:00/)).toBeInTheDocument();
  });

  it("shows greenhouse_manager's work even though it has no rule in the catalog", () => {
    // The rule table is sales_rep / document_team / transport / loading /
    // export_manager / quality_inspector only. A greenhouse manager's entire
    // queue is the weekly-plan kind, so dropping this section would make the
    // page read as "you have no tasks" to that role.
    renderPage([rule()]);

    expect(screen.getByText('Greenhouse Manager')).toBeInTheDocument();
    expect(screen.getByText('Seller')).toBeInTheDocument();
  });

  it('explains a task whose role has no rule left in the catalog', () => {
    renderPage([rule()]);

    expect(screen.getByText(/keeps the role it was given/)).toBeInTheDocument();
  });

  it('lists the gate guard kind among the code-driven tasks', () => {
    renderPage([rule()]);
    expect(screen.getByText('Gate guard: mark arrival and exit')).toBeInTheDocument();
  });
  it('shows what a chained rule waits for and labels a confirm button', () => {
    renderPage([rule({
      id: 2, step: 'gumruk_girish', title_key: 'tasks.print_cmr', target_fields: [],
      completion_rule: 'confirm', completion_rule_display: 'Button that gates the step',
      depends_on: ['tasks.prepare_contract', 'tasks.fill_gross_net'],
    })]);
    expect(screen.getByText('Button (holds the step)')).toBeInTheDocument();
    expect(screen.getByText('After:')).toBeInTheDocument();
    expect(screen.getByText('Gross/net: pick the packing')).toBeInTheDocument();
  });
});

describe('TaskRulesPage assignees', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { role: 'admin', is_superuser: false };
  });

  it('shows "Whole role" when a rule has no assignees', () => {
    renderPage([rule({ assignees: [] })]);
    expect(screen.getByText('Whole role')).toBeInTheDocument();
  });

  it('lists named assignees', () => {
    renderPage([rule({ assignees: [{ id: 7, full_name: 'Ahmed' }] })]);
    expect(screen.getByText('Ahmed')).toBeInTheDocument();
  });

  it('shows the edit button to admin', () => {
    renderPage([rule()]);
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument();
  });

  it('hides the edit button from other roles', () => {
    authState.user = { role: 'warehouse_chief', is_superuser: false };
    renderPage([rule()]);
    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
  });

  it('saves only users who are still valid candidates', () => {
    // A stored assignee who was later deactivated is no longer a candidate; the
    // backend would 400 on his id, so the editor must not send it back.
    const mutate = vi.fn();
    vi.mocked(useSetTaskRuleAssignees).mockReturnValue(
      { mutate, isPending: false } as unknown as ReturnType<typeof useSetTaskRuleAssignees>,
    );
    vi.mocked(useTaskRuleCandidates).mockReturnValue(
      { data: [{ id: 1, full_name: 'Ahmed', role: 'export_manager' }], isLoading: false } as
        unknown as ReturnType<typeof useTaskRuleCandidates>,
    );
    renderPage([rule({ assignees: [{ id: 1, full_name: 'Ahmed' }, { id: 9, full_name: 'Gone' }] })]);
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith({ ruleId: 1, userIds: [1] }, expect.anything());
  });

  it('blocks Save until the candidates have loaded', () => {
    // Saving while the list is still loading would send [] and clear the rule.
    vi.mocked(useTaskRuleCandidates).mockReturnValue(
      { data: undefined, isLoading: true } as unknown as ReturnType<typeof useTaskRuleCandidates>,
    );
    renderPage([rule({ assignees: [{ id: 1, full_name: 'Ahmed' }] })]);
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('blocks Save when the candidates failed to load', () => {
    vi.mocked(useTaskRuleCandidates).mockReturnValue(
      { data: undefined, isLoading: false, isError: true } as unknown as ReturnType<typeof useTaskRuleCandidates>,
    );
    renderPage([rule({ assignees: [{ id: 1, full_name: 'Ahmed' }] })]);
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('tells the admin when the server rejects the save', () => {
    const mutate = vi.fn();
    vi.mocked(useSetTaskRuleAssignees).mockReturnValue(
      { mutate, isPending: false } as unknown as ReturnType<typeof useSetTaskRuleAssignees>,
    );
    vi.mocked(useTaskRuleCandidates).mockReturnValue(
      { data: [{ id: 1, full_name: 'Ahmed', role: 'export_manager' }], isLoading: false, isError: false } as
        unknown as ReturnType<typeof useTaskRuleCandidates>,
    );
    renderPage([rule()]);
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const options = mutate.mock.calls[0][1] as { onError: () => void };
    options.onError();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Could not save'));
  });
});
