import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useDailyProgress } from '@/hooks/useDailyProgress';
import { GaplamaPlanStrip, stockShortfall } from './GaplamaPlanStrip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
vi.mock('@/hooks/useDailyProgress', () => ({ useDailyProgress: vi.fn() }));

function withDay(packed: number, loadingTarget: number) {
  vi.mocked(useDailyProgress).mockReturnValue({
    data: { date: '2026-09-28', days: [{ date: '2026-09-28', day_of_week: 1, rows: [], plan_total: loadingTarget,
      export_parts: 0, export_parts_packed: 0, packed, loading_target: loadingTarget }] },
  } as unknown as ReturnType<typeof useDailyProgress>);
}

describe('stockShortfall', () => {
  it('compares what is left to pack with whole trucks in stock', () => {
    expect(stockShortfall({ packed: 3, loadingTarget: 6, availableKg: 37000, capacityKg: 18500 }))
      .toEqual({ remaining: 3, stockTrucks: 2, shortfall: 1 });
  });

  it('never goes negative when packing is ahead of the target', () => {
    expect(stockShortfall({ packed: 7, loadingTarget: 6, availableKg: 0, capacityKg: 18500 }))
      .toEqual({ remaining: 0, stockTrucks: 0, shortfall: 0 });
  });
});

describe('GaplamaPlanStrip', () => {
  it('shows packed of target, the stock and the shortfall', () => {
    withDay(3, 6);
    render(<GaplamaPlanStrip day="2026-09-28" availableKg={37000} truckCapacityKg={18500} />);
    expect(screen.getByText('tir_takip.gaplama.plan_packed:{"done":3,"total":6}')).toBeInTheDocument();
    expect(screen.getByText(/tir_takip.gaplama.plan_stock:\{"count":2\}/)).toBeInTheDocument();
    expect(screen.getByText(/tir_takip.gaplama.plan_short:\{"count":1\}/)).toBeInTheDocument();
  });

  it('hides the shortfall when stock covers what is left', () => {
    withDay(5, 6);
    render(<GaplamaPlanStrip day="2026-09-28" availableKg={18500} truckCapacityKg={18500} />);
    expect(screen.queryByText(/plan_short/)).not.toBeInTheDocument();
  });

  it('renders nothing when the day is not in the response', () => {
    withDay(1, 1);
    const { container } = render(<GaplamaPlanStrip day="2026-10-04" availableKg={0} truckCapacityKg={18500} />);
    expect(container).toBeEmptyDOMElement();
  });
});
