import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import i18n from '@/i18n';
import type { ITirHasabatResponse } from '@/hooks/useTirHasabat';
import HasabatTab from './HasabatTab';

// ECharts needs a real canvas; the chart options are covered by
// `HasabatTab.charts.test.ts`. Here only the panel it sits in matters.
vi.mock('@/components/EChart', () => ({
  EChart: ({ ariaLabel }: { ariaLabel?: string }) => <div data-testid="chart" aria-label={ariaLabel} />,
}));

let query: { data?: ITirHasabatResponse; isLoading: boolean; isError: boolean };

vi.mock('@/hooks/useTirHasabat', () => ({
  useTirHasabat: () => query,
}));

const emptyGroup = { rows: [], total_kg: 0 };

function payload(over: Partial<ITirHasabatResponse> = {}): ITirHasabatResponse {
  return {
    season: { id: 1, name: '2025/2026' },
    kpis: { total_trucks: 3, total_kg: 38_000, avg_kg: 12_667, open_trucks: 2, arrived_trucks: 1 },
    by_month: [{ month: '2026-01', trucks: 1, kg: 18_000 }],
    by_country: {
      rows: [
        { name: 'Russia', trucks: 1, kg: 20_000 },
        { name: null, trucks: 2, kg: 18_000 },
      ],
      total_kg: 38_000,
    },
    by_customer: { rows: [{ name: 'Begjan', trucks: 3, kg: 38_000 }], total_kg: 38_000 },
    by_variety: emptyGroup,
    // Firm kg comes from the split table and totals less than the headline.
    by_firm: { rows: [{ name: 'X', trucks: 2, kg: 10_000 }], total_kg: 10_000 },
    by_block: emptyGroup,
    ...over,
  };
}

const panel = (title: string) =>
  screen.getByRole('heading', { name: new RegExp(title) }).closest('section') as HTMLElement;

describe('HasabatTab', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    query = { data: payload(), isLoading: false, isError: false };
  });

  it('shows the five KPI cards and says which trucks are left out', () => {
    const { container } = render(<HasabatTab />);
    // "Total kg" is also a table column header, so read the cards only.
    const cards = within(container.querySelector('.sera-kpis') as HTMLElement);

    expect(cards.getByText('Total trucks').nextSibling).toHaveTextContent('3');
    expect(cards.getByText('Total kg').nextSibling).toHaveTextContent('38K');
    expect(cards.getByText('Average kg / truck').nextSibling).toHaveTextContent('13K');
    expect(cards.getByText('Open trucks').nextSibling).toHaveTextContent('2');
    expect(cards.getByText('Arrived trucks').nextSibling).toHaveTextContent('1');
    expect(screen.getByText(/not counted/)).toBeInTheDocument();
  });

  it('renders only the panels that have data', () => {
    render(<HasabatTab />);

    expect(screen.getByRole('heading', { name: /kg and trucks by month/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /kg by customer/ })).toBeInTheDocument();
    // No block rows, no variety rows.
    expect(screen.queryByRole('heading', { name: /kg by block/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /By tomato variety/ })).toBeNull();
  });

  it('labels the no-value group and takes shares from the panel total', () => {
    render(<HasabatTab />);

    const countries = within(panel('Countries — detail'));
    expect(countries.getByText('Unknown')).toBeInTheDocument();
    expect(countries.getByText('53%')).toBeInTheDocument(); // 20 000 / 38 000

    // 10 000 of the firm panel's own 10 000 — not of the 38 000 headline.
    expect(within(panel('Export firms — detail')).getByText('100%')).toBeInTheDocument();
  });

  it('keeps the donut side legend next to the chart', () => {
    render(<HasabatTab />);

    const donut = within(panel('kg share by country'));
    expect(donut.getByTestId('chart')).toBeInTheDocument();
    expect(donut.getByText('Russia').nextSibling).toHaveTextContent('53%');
  });

  it('shows the source hint when the season has no trucks yet', () => {
    query.data = payload({
      kpis: { total_trucks: 0, total_kg: 0, avg_kg: 0, open_trucks: 0, arrived_trucks: 0 },
      by_month: [],
      by_country: emptyGroup,
      by_customer: emptyGroup,
      by_firm: emptyGroup,
    });
    render(<HasabatTab />);

    expect(screen.getByText(/Reports appear automatically/)).toBeInTheDocument();
    expect(screen.queryAllByTestId('chart')).toHaveLength(0);
  });

  it('says so when there is no active season', () => {
    query.data = payload({ season: null });
    render(<HasabatTab />);

    expect(screen.getByText('No active season — nothing to report.')).toBeInTheDocument();
  });

  it('shows the error state when the request fails', () => {
    query = { data: undefined, isLoading: false, isError: true };
    render(<HasabatTab />);

    expect(screen.getByText('An error occurred. Please try again.')).toBeInTheDocument();
  });
});
