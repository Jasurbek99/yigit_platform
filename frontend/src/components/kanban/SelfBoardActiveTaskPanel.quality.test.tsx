import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import i18n from '@/i18n';
import { SelfBoardActiveTaskPanel } from './SelfBoardActiveTaskPanel';
import { useStartTask, useCompleteTask } from '@/hooks/useTaskActions';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentSheetItem, ITaskListItem, TaskState } from '@/types';

vi.mock('@/hooks/useTaskActions', () => ({ useStartTask: vi.fn(), useCompleteTask: vi.fn() }));
vi.mock('@/services/api', () => ({
  default: { patch: vi.fn(), get: vi.fn(() => Promise.resolve({ data: [] })), post: vi.fn() },
}));

const startMutate = vi.fn();

function makeTask(titleKey: string, state: TaskState): ITaskListItem {
  return {
    id: 21, shipment: 7, shipment_code: 'QI-7/26', kind: 'shipment', link: '',
    scope_year: null, scope_week: null, scope_block: null, scope_block_code: null,
    scope_location: null, truck_plate: null, step: 'yuklenme', phase: 'LOAD',
    title_key: titleKey, assignee_role: 'quality_inspector', assignee_user: null,
    assignee_user_name: null, completion_rule: 'manual_done',
    target_fields_list: ['quality.hil_sertifikaty', 'transit_days', 'shelf_life_days'],
    deadline: null, deadline_rule: '', state, is_overdue: false,
    created_at: '2026-10-01T08:00:00Z', started_at: null, completed_at: null,
    blocked_reason: '', cancelled_reason: '',
  } as ITaskListItem;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.hash}</div>;
}

function renderPanel(task: ITaskListItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/me/board']}>
      <QueryClientProvider client={client}>
        <SelfBoardActiveTaskPanel
          task={task}
          shipment={{ ...MOCK_SHIPMENT_DETAIL, id: 7 }}
          onComplete={vi.fn()}
          sheetItem={{ id: 7 } as IShipmentSheetItem}
          rows={[]}
          rowSettings={{}}
          isSheetLoading={false}
        />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const markDone = () => screen.getByRole('button', { name: 'Mark task done' });
const uploadButton = () => screen.getByRole('button', { name: /Upload certificates/ });

// Owner 2026-10-01: the quality task shows «Upload certificates», which goes
// straight to the shipment, and «Done» stays off until that button is pressed.
describe('SelfBoardActiveTaskPanel — quality inspection', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  beforeEach(() => {
    startMutate.mockReset();
    startMutate.mockImplementation((_vars, options) => options?.onSuccess?.());
    vi.mocked(useStartTask).mockReturnValue(
      { mutate: startMutate, isPending: false } as unknown as ReturnType<typeof useStartTask>,
    );
    vi.mocked(useCompleteTask).mockReturnValue(
      { mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useCompleteTask>,
    );
  });

  it('keeps Done disabled, with a hint, until the task is started', () => {
    renderPanel(makeTask('tasks.quality_inspection', 'open'));
    expect(markDone()).toBeDisabled();
    expect(screen.getByText('Press «Upload certificates» first')).toBeInTheDocument();
  });

  it('enables Done once the task is in progress', () => {
    renderPanel(makeTask('tasks.quality_inspection', 'in_progress'));
    expect(markDone()).toBeEnabled();
  });

  it('starts the task and opens the shipment at the certificates', () => {
    renderPanel(makeTask('tasks.quality_inspection', 'open'));
    fireEvent.click(uploadButton());
    expect(startMutate).toHaveBeenCalledWith({ taskId: 21, shipmentId: 7 }, expect.anything());
    expect(screen.getByTestId('location')).toHaveTextContent('/shipments/7#detail-field-quality.azyk_maglumatnama');
  });

  it('does not start the quality task from a field click', () => {
    renderPanel(makeTask('tasks.quality_inspection', 'open'));
    fireEvent.click(screen.getByText('Transit days'));
    expect(startMutate).not.toHaveBeenCalled();
  });

  it('still auto-starts any other task from a field click', () => {
    renderPanel(makeTask('tasks.fill_loading_data', 'open'));
    fireEvent.click(screen.getByText('Transit days'));
    expect(startMutate).toHaveBeenCalled();
  });

  it('shows the upload button only on the quality task', () => {
    renderPanel(makeTask('tasks.fill_loading_data', 'open'));
    expect(screen.queryByRole('button', { name: /Upload certificates/ })).not.toBeInTheDocument();
  });
});
