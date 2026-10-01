import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import TransportPlanPage from './TransportPlanPage';

dayjs.extend(isoWeek);

// Viewers on KZ/RU domain machines often run UTC; times must read in TM time.
process.env.TZ = 'UTC';

const mutate = vi.fn();
let plan: unknown;
let lastWeek: [number, number] | null = null;

vi.mock('@/hooks/usePlanAck', () => ({
  useTransportPlan: (year: number, week: number) => {
    lastWeek = [year, week];
    return { data: plan, isLoading: false };
  },
  useAcknowledgeTask: () => ({ mutate, isPending: false }),
}));

const DAYS = [1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, date: `2026-09-${27 + d}` }));

function renderPage(url = '/transport/plan?week=40&year=2026') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <TransportPlanPage />
    </MemoryRouter>,
  );
}

describe('TransportPlanPage', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('shows counts, highlights a changed cell and acknowledges', async () => {
    plan = {
      year: 2026, week: 40, days: DAYS,
      destinations: [{ id: 3, name: 'Russia' }],
      cells: [
        { day_of_week: 1, destination_id: 3, truck_count: 2, acknowledged_count: 1 },
        { day_of_week: 2, destination_id: 3, truck_count: 1, acknowledged_count: 1 },
      ],
      open_task_id: 51, acknowledged_at: '2026-09-26T16:05:00+05:00',
      snapshot: '1:3:2;2:3:1', can_acknowledge: true,
    };
    renderPage();
    expect(screen.getByText('Russia')).toBeInTheDocument();
    const changed = screen.getByTestId('cell-1-3');
    expect(changed).toHaveTextContent('2');
    expect(changed).toHaveAttribute('data-changed', 'true');
    expect(screen.getByTestId('cell-2-3')).toHaveAttribute('data-changed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Reviewed' }));
    expect(mutate).toHaveBeenCalledWith({ taskId: 51, snapshot: '1:3:2;2:3:1' });

    expect(screen.getByText('Last reviewed: 26.09 16:05')).toBeInTheDocument();
  });

  it('hides the button from a role that may not acknowledge', () => {
    plan = {
      year: 2026, week: 40, days: DAYS, destinations: [{ id: 3, name: 'Russia' }],
      cells: [{ day_of_week: 1, destination_id: 3, truck_count: 2, acknowledged_count: 1 }],
      open_task_id: 51, acknowledged_at: null, snapshot: '1:3:2', can_acknowledge: false,
    };
    renderPage();
    expect(screen.queryByRole('button', { name: 'Reviewed' })).toBeNull();
  });

  it('never-acknowledged week has no highlights and no button without a task', () => {
    plan = {
      year: 2026, week: 40, days: DAYS, destinations: [{ id: 3, name: 'Russia' }],
      cells: [{ day_of_week: 1, destination_id: 3, truck_count: 2, acknowledged_count: null }],
      open_task_id: null, acknowledged_at: null, snapshot: '1:3:2', can_acknowledge: true,
    };
    renderPage();
    expect(screen.getByTestId('cell-1-3')).toHaveAttribute('data-changed', 'false');
    expect(screen.queryByRole('button', { name: 'Reviewed' })).toBeNull();
  });

  it('empty week shows the empty state', () => {
    plan = {
      year: 2026, week: 40, days: DAYS, destinations: [], cells: [], open_task_id: null,
      acknowledged_at: null, snapshot: '', can_acknowledge: true,
    };
    renderPage();
    expect(screen.getByText('No truck allocation for this week')).toBeInTheDocument();
  });

  it('opens on the current week without params', () => {
    plan = {
      year: 2026, week: 40, days: DAYS, destinations: [], cells: [], open_task_id: null,
      acknowledged_at: null, snapshot: '', can_acknowledge: true,
    };
    renderPage('/transport/plan');
    expect(lastWeek).toEqual([dayjs().isoWeekYear(), dayjs().isoWeek()]);
  });

  it('prev / next arrows move one week', async () => {
    plan = {
      year: 2026, week: 40, days: DAYS, destinations: [], cells: [], open_task_id: null,
      acknowledged_at: null, snapshot: '', can_acknowledge: true,
    };
    renderPage();
    expect(screen.getByText(/Week 40 · 2026 · 28\.09–03\.10/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(lastWeek).toEqual([2026, 41]);
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(lastWeek).toEqual([2026, 39]);
  });
});
