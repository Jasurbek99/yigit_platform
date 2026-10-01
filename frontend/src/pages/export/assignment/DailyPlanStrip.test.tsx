import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useDailyProgress } from '@/hooks/useDailyProgress';
import { DailyPlanStrip } from './DailyPlanStrip';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useDailyProgress', () => ({ useDailyProgress: vi.fn() }));
const mutate = vi.fn();
vi.mock('@/hooks/useDrafts', () => ({ useCreateExportPart: () => ({ mutate, isPending: false }) }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
// useShipmentPatch pulls in services/api → the real i18n setup, which the
// react-i18next mock above can't satisfy; only its error formatter is used.
vi.mock('@/hooks/useShipmentPatch', () => ({
  extractPatchError: (_err: unknown, fallback: string) => fallback,
}));

const WEEK = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];

const ROWS = [
  { key: 'country:3', label: 'Russia', country_id: 3, is_gapy: false, plan: 4, fact: 3 },
  { key: 'gapy', label: 'Gapy Satys', country_id: null, is_gapy: true, plan: 1, fact: 1 },
];

function day(date: string, rows: typeof ROWS) {
  return { date, day_of_week: 1, rows, plan_total: 0, export_parts: 4, export_parts_packed: 3,
    packed: 3, loading_target: 4 };
}

function withData(today = '2026-09-28') {
  vi.mocked(useDailyProgress).mockReturnValue({
    data: { date: today, days: WEEK.map((d) => day(d, d === '2026-09-28' ? ROWS : [])) },
  } as unknown as ReturnType<typeof useDailyProgress>);
}

describe('DailyPlanStrip', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows each plan row as fact/plan and the packing count', () => {
    withData();
    render(<DailyPlanStrip canCreate />);
    expect(screen.getByText('Russia 3/4')).toBeInTheDocument();
    expect(screen.getByText('Gapy Satys 1/1')).toBeInTheDocument();
    expect(screen.getByText('tasks.progress_packing')).toBeInTheDocument();
  });

  it('«+» on a country row creates with that country and opens the new part', () => {
    withData();
    render(<DailyPlanStrip canCreate />);
    fireEvent.click(screen.getByRole('button', { name: 'assign.add_export_part: Russia' }));
    expect(mutate.mock.calls[0][0]).toEqual({ country: 3 });
    mutate.mock.calls[0][1].onSuccess({ id: 77 });
    expect(navigate).toHaveBeenCalledWith('/shipments/77');
  });

  it('«+» on the Gapy row creates a gapy part without a country', () => {
    withData();
    render(<DailyPlanStrip canCreate />);
    fireEvent.click(screen.getByRole('button', { name: 'assign.add_export_part: Gapy Satys' }));
    expect(mutate.mock.calls[0][0]).toEqual({ isGapy: true });
  });

  it('hides «+» without the create right', () => {
    withData();
    render(<DailyPlanStrip canCreate={false} />);
    expect(screen.queryByRole('button', { name: /assign.add_export_part/ })).not.toBeInTheDocument();
  });

  it('opens a Mon–Sat week table', () => {
    withData();
    render(<DailyPlanStrip canCreate />);
    fireEvent.click(screen.getByRole('button', { name: 'assign.week_plan' }));
    expect(screen.getByTestId('plan-week').querySelectorAll('thead th')).toHaveLength(7);
  });

  it('renders nothing on a day outside Mon–Sat (Sunday) or without data', () => {
    withData('2026-10-04');
    const { container } = render(<DailyPlanStrip canCreate />);
    expect(container).toBeEmptyDOMElement();
    vi.mocked(useDailyProgress).mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useDailyProgress>);
    const second = render(<DailyPlanStrip canCreate />);
    expect(second.container).toBeEmptyDOMElement();
  });
});
