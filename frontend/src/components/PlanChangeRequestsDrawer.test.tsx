import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanChangeRequestsDrawer } from './PlanChangeRequestsDrawer';
import type { IPlanChangeRequest } from '@/types';

const approveMutate = vi.fn();
const rejectMutate = vi.fn();
const listHook = vi.fn();

const ROW: IPlanChangeRequest = {
  id: 41, entry: 1203, block: 5, block_code: 'F', entry_date: '2026-06-10', weekday: 2,
  baseline_value: '10000.00', current_value: '10000.00', requested_value: '11500.00', change_pct: '15.00',
  status: 'pending', reason: 'cold snap', requested_by: 17, requested_by_name: 'Myrat',
  requested_at: '2026-06-10T09:10:00+05:00', decided_by: null, decided_by_name: null, decided_at: null,
  decision_note: '',
};

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/usePlanning', () => ({
  usePlanChangeRequests: (filters: unknown) => listHook(filters),
  useApprovePlanChange: () => ({ mutate: approveMutate, isPending: false }),
  useRejectPlanChange: () => ({ mutate: rejectMutate, isPending: false }),
}));

const props = { open: true, onClose: vi.fn(), year: 2026, week: 24 };

describe('PlanChangeRequestsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listHook.mockReturnValue({ data: { count: 1, next: null, previous: null, results: [ROW] }, isLoading: false });
  });

  it('defaults to every week, so Fri–Sun approvers still see the current-week queue', () => {
    render(<PlanChangeRequestsDrawer {...props} canDecide />);
    expect(listHook.mock.calls[0][0]).toEqual({ status: 'pending' });
    expect(listHook.mock.calls[0][0]).not.toHaveProperty('year');
    expect(listHook.mock.calls[0][0]).not.toHaveProperty('week');
  });

  it('shows an error instead of the empty state when the list fails to load', () => {
    listHook.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<PlanChangeRequestsDrawer {...props} canDecide />);
    expect(screen.getByRole('alert')).toHaveTextContent('common.error');
  });

  it('lists the request with its signed percentage', () => {
    render(<PlanChangeRequestsDrawer {...props} canDecide={false} />);
    expect(screen.getByText('+15%')).toBeInTheDocument();
    expect(screen.getByText('11,500')).toBeInTheDocument();
    expect(screen.getByText('cold snap')).toBeInTheDocument();
  });

  it('hides decision buttons from non-approvers', () => {
    render(<PlanChangeRequestsDrawer {...props} canDecide={false} />);
    expect(screen.queryByRole('button', { name: 'plan.change_approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'plan.change_reject' })).not.toBeInTheDocument();
  });

  it('approver: Approve → confirm calls the approve mutation', async () => {
    render(<PlanChangeRequestsDrawer {...props} canDecide />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.change_approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    expect(approveMutate).toHaveBeenCalledWith({ id: 41 }, expect.any(Object));
  });

  it('approver: Reject → note → OK calls the reject mutation with the note', async () => {
    render(<PlanChangeRequestsDrawer {...props} canDecide />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.change_reject' }));
    fireEvent.change(await screen.findByPlaceholderText('plan.change_reject_note_placeholder'), {
      target: { value: 'too high' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(rejectMutate).toHaveBeenCalledWith({ id: 41, note: 'too high' }, expect.any(Object));
  });
});
