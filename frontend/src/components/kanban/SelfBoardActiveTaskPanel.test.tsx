import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { SelfBoardActiveTaskPanel } from './SelfBoardActiveTaskPanel';
import { useStartTask, useCompleteTask } from '@/hooks/useTaskActions';
import type { IShipmentDetail, ITaskListItem } from '@/types';

vi.mock('@/hooks/useTaskActions', () => ({
  useStartTask: vi.fn(),
  useCompleteTask: vi.fn(),
}));

function gateTask(overrides: Partial<ITaskListItem> = {}): ITaskListItem {
  return {
    id: 10, shipment: 7, shipment_code: '0000007/26', kind: 'gate', link: '/export/gate',
    scope_year: null, scope_week: null, scope_block: null, scope_block_code: null,
    scope_location: 3, truck_plate: '1535AKM', step: 'gate_arrive', phase: 'DOCS',
    title_key: 'tasks.gate_arrive', assignee_role: 'garawul', assignee_user: null,
    assignee_user_name: null, target_fields_list: [], completion_rule: 'manual_done',
    deadline: null, deadline_rule: '', state: 'open', is_overdue: false,
    created_at: '2026-09-29T08:00:00Z', started_at: null, completed_at: null, blocked_reason: '',
    cancelled_reason: '',
    ...overrides,
  } as ITaskListItem;
}

describe('SelfBoardActiveTaskPanel — gate tasks (final-fix review F10)', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('renders the title with the truck plate and hides the generic Mark done button', () => {
    vi.mocked(useStartTask).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useStartTask>);
    vi.mocked(useCompleteTask).mockReturnValue(
      { mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useCompleteTask>,
    );

    render(
      <SelfBoardActiveTaskPanel
        task={gateTask()}
        shipment={{} as unknown as IShipmentDetail}
        onComplete={vi.fn()}
        sheetItem={null}
        rows={[]}
        rowSettings={{}}
        isSheetLoading={false}
      />,
    );

    expect(screen.getByText('Truck 1535AKM is due — mark arrival')).toBeInTheDocument();
    expect(screen.getByText('Gate guard')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
