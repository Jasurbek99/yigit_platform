import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useDailyProgress } from '@/hooks/useDailyProgress';
import { useJoinBoard } from '@/hooks/useDrafts';
import { DailyExportModal } from './DailyExportModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
vi.mock('@/hooks/useDailyProgress', () => ({ useDailyProgress: vi.fn() }));
vi.mock('@/hooks/useDrafts', () => ({
  useJoinBoard: vi.fn(),
  useCreateExportPart: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useShipmentPatch', () => ({ extractPatchError: (_e: unknown, f: string) => f }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'export_manager', permissions: {} } }) }));
vi.mock('@/hooks/useSeasonReadOnly', () => ({ useSeasonReadOnly: () => false }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const TODAY = '2026-10-02';

function part(id: number, over: Record<string, unknown>) {
  return { id, shipment_code: `S-${id}`, date: TODAY, country: 3, customer: 9, country_name: 'Russia',
    customer_name: 'Buyer', block_sources: [], ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useDailyProgress).mockReturnValue({
    data: { date: TODAY, days: [] },
  } as unknown as ReturnType<typeof useDailyProgress>);
  vi.mocked(useJoinBoard).mockReturnValue({
    data: [
      part(7, {}),                                                         // today, waits for packing
      part(8, { block_sources: [{ block_code: 'A', weight_kg: 1000 }] }),  // today, packed
      part(9, { date: '2026-10-03' }),                                     // tomorrow
      part(10, { country: null, customer: null, block_sources: [{ block_code: 'A', weight_kg: 1 }] }), // free packing
    ],
  } as unknown as ReturnType<typeof useJoinBoard>);
});

describe('DailyExportModal', () => {
  it('lists only today\'s export parts that still wait for packing', () => {
    render(<DailyExportModal onClose={vi.fn()} boardLink="/export/assign" />);
    expect(screen.getByText('tasks.daily_export_waiting:{"count":1}')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /S-7/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /S-8|S-9|S-10/ })).not.toBeInTheDocument();
  });

  it('opens a waiting part\'s page and closes itself', () => {
    const onClose = vi.fn();
    render(<DailyExportModal onClose={onClose} boardLink="/export/assign" />);
    fireEvent.click(screen.getByRole('button', { name: /S-7/ }));
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/shipments/7');
  });

  it('opens the assignment board from the footer', () => {
    render(<DailyExportModal onClose={vi.fn()} boardLink="/export/assign" />);
    fireEvent.click(screen.getByRole('button', { name: 'assign.page_title' }));
    expect(navigate).toHaveBeenCalledWith('/export/assign');
  });

  it('says so when nothing waits for packing', () => {
    vi.mocked(useJoinBoard).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useJoinBoard>);
    render(<DailyExportModal onClose={vi.fn()} boardLink="/export/assign" />);
    expect(screen.getByText('tasks.daily_export_none_waiting')).toBeInTheDocument();
  });
});
