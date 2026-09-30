import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { SelfBoardActiveTaskPanel } from './SelfBoardActiveTaskPanel';
import { useStartTask, useCompleteTask } from '@/hooks/useTaskActions';
import type { IShipmentDetail, ITaskListItem } from '@/types';

vi.mock('@/hooks/useTaskActions', () => ({
  useStartTask: vi.fn(),
  useCompleteTask: vi.fn(),
}));

const complete = vi.fn();

function docsTask(overrides: Partial<ITaskListItem> = {}): ITaskListItem {
  return {
    id: 21, shipment: 7, shipment_code: '0000007/26', kind: 'shipment', link: '',
    scope_year: null, scope_week: null, scope_block: null, scope_block_code: null,
    scope_location: null, truck_plate: null, scope_date: null, step: 'gumruk_girish', phase: 'DOCS',
    title_key: 'tasks.print_cmr', assignee_role: 'document_team', assignee_user: null,
    assignee_user_name: null, target_fields_list: [], completion_rule: 'confirm',
    deadline: null, deadline_rule: '', state: 'open', is_overdue: false,
    created_at: '2026-09-30T08:00:00Z', started_at: null, completed_at: null, blocked_reason: '',
    cancelled_reason: '',
    ...overrides,
  } as ITaskListItem;
}

function renderPanel(task: ITaskListItem) {
  return render(
    <MemoryRouter>
      <SelfBoardActiveTaskPanel
        task={task}
        shipment={{ id: 7, block_sources: [] } as unknown as IShipmentDetail}
        onComplete={vi.fn()}
        sheetItem={null}
        rows={[]}
        rowSettings={{}}
        isSheetLoading={false}
      />
    </MemoryRouter>,
  );
}

describe('SelfBoardActiveTaskPanel — PREP/DOCS chain (2026-09-30)', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => {
    vi.mocked(useStartTask).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useStartTask>);
    vi.mocked(useCompleteTask).mockReturnValue(
      { mutate: complete, isPending: false } as unknown as ReturnType<typeof useCompleteTask>,
    );
  });

  it('a confirm task shows its own button and completes', async () => {
    renderPanel(docsTask());
    await userEvent.click(screen.getByRole('button', { name: 'Printed' }));
    expect(complete).toHaveBeenCalled();
  });

  it('the new target fields have a label in every language', () => {
    for (const lng of ['en', 'ru', 'tk']) {
      for (const key of ['trip_id', 'truck_head_id', 'packing_template', 'advance_links', 'has_current_advance', 'customs_exit_at']) {
        expect(i18n.getFixedT(lng)(`tasks.field_label.${key}`, { defaultValue: '' })).not.toBe('');
      }
    }
  });

  it('join_supply links to the Assignment board', () => {
    renderPanel(docsTask({
      title_key: 'tasks.join_supply', completion_rule: 'any_field_filled',
      target_fields_list: ['block_sources'], step: 'draft', assignee_role: 'export_manager',
    }));
    expect(screen.getByRole('link', { name: /Assignment board/ })).toHaveAttribute('href', '/export/assign');
  });
});
