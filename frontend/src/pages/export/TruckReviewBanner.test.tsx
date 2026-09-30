import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { TruckReviewBanner } from './TruckReviewBanner';

const mutate = vi.fn();
let review: unknown = null;

vi.mock('@/hooks/usePlanAck', () => ({
  useTruckAllocationReview: () => ({ data: review }),
  useAcknowledgeTask: () => ({ mutate, isPending: false }),
}));

describe('TruckReviewBanner', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('renders nothing without an open review', () => {
    review = { year: 2026, week: 40, open_task_id: null, changes: [], snapshot: ';', can_acknowledge: true };
    const { container } = render(<TruckReviewBanner year={2026} week={40} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists changed days and acknowledges', async () => {
    review = {
      year: 2026, week: 40, open_task_id: 7, changes: [{ day_of_week: 2, was: 1, now: 2 }],
      snapshot: '2:2', can_acknowledge: true,
    };
    render(<TruckReviewBanner year={2026} week={40} />);
    expect(screen.getByText(/Tue: 1 → 2/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reviewed' }));
    expect(mutate).toHaveBeenCalledWith({ taskId: 7, snapshot: '2:2' });
  });

  it('shows the change but no button to a role that may not acknowledge', () => {
    review = {
      year: 2026, week: 40, open_task_id: 7, changes: [{ day_of_week: 2, was: 1, now: 2 }],
      snapshot: '2:2', can_acknowledge: false,
    };
    render(<TruckReviewBanner year={2026} week={40} />);
    expect(screen.getByText(/Tue: 1 → 2/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reviewed' })).toBeNull();
  });
});
