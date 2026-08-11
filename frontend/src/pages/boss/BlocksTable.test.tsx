import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { BlocksTable } from './BlocksTable';
import api from '@/services/api';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

vi.mock('@/services/api', () => ({
  default: { get: vi.fn() },
}));

// Two blocks, so no total ever equals a single row's value — a one-block fixture
// makes every assertion below ambiguous between the data row and the footer.
const DAILY = {
  rows: [
    {
      block_code: 'A1',
      block_name: 'Block A1',
      plan_kg: 3000,
      actual_kg: 2800,
      pct: 93.3,
      monthly_plan_kg: 62000,
      monthly_actual_kg: 58000,
      monthly_pct: 93.5,
    },
    {
      block_code: 'B2',
      block_name: 'Block B2',
      plan_kg: 1000,
      actual_kg: 900,
      pct: 90.0,
      monthly_plan_kg: 20000,
      monthly_actual_kg: 19000,
      monthly_pct: 95.0,
    },
  ],
  scope: 'daily',
};

const SEASONAL = {
  rows: [
    { ...DAILY.rows[0], plan_kg: 210000, actual_kg: 198000, pct: 94.3 },
    { ...DAILY.rows[1], plan_kg: 90000, actual_kg: 85000, pct: 94.4 },
  ],
  scope: 'seasonal',
};

const MARKET = {
  rows: [
    { block_code: 'A1', export_kg: 185400, export_pct: 12.1 },
    { block_code: 'B2', export_kg: 50000, export_pct: 3.3 },
  ],
};

function mockApi() {
  vi.mocked(api.get).mockImplementation((url: string, config?: { params?: Record<string, string> }) => {
    if (url.includes('export_market')) return Promise.resolve({ data: MARKET });
    if (config?.params?.scope === 'seasonal') return Promise.resolve({ data: SEASONAL });
    return Promise.resolve({ data: DAILY });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

function renderTable() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BlocksTable period="month" />
    </QueryClientProvider>,
  );
}

describe('BlocksTable', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('renders one row per block with the harvest and export figures side by side', async () => {
    renderTable();

    expect(await screen.findByText('Block A1')).toBeInTheDocument();
    expect(screen.getByText('Block B2')).toBeInTheDocument();
    expect(screen.getByText('2,800')).toBeInTheDocument();   // today actual
    expect(screen.getByText('58,000')).toBeInTheDocument();  // month actual
    expect(screen.getByText('198,000')).toBeInTheDocument(); // season actual
    expect(screen.getByText('185,400')).toBeInTheDocument(); // export kg
  });

  it('sums every group into the total row', async () => {
    renderTable();
    await screen.findByText('Block A1');

    expect(screen.getByText('3,700')).toBeInTheDocument();   // 2 800 + 900
    expect(screen.getByText('77,000')).toBeInTheDocument();  // 58 000 + 19 000
    expect(screen.getByText('283,000')).toBeInTheDocument(); // 198 000 + 85 000
    expect(screen.getByText('235,400')).toBeInTheDocument(); // 185 400 + 50 000
  });

  it('opens the harvest plan when a production cell group is clicked', async () => {
    renderTable();
    await screen.findByText('Block A1');

    await userEvent.click(screen.getByRole('button', { name: 'Block A1' }));

    expect(navigate).toHaveBeenCalledWith('/export/plan?block=A1');
  });

  it('opens the harvest plan when the season % bar is clicked', async () => {
    renderTable();
    await screen.findByText('Block A1');

    await userEvent.click(screen.getByRole('button', { name: 'Block A1 Season %' }));

    expect(navigate).toHaveBeenCalledWith('/export/plan?block=A1');
  });

  it('opens the shipment list when the export cell group on the same row is clicked', async () => {
    renderTable();
    await screen.findByText('Block A1');

    await userEvent.click(screen.getByRole('button', { name: 'A1 Export Market' }));

    expect(navigate).toHaveBeenCalledWith('/export/shipments?block_source=A1');
  });

  it('labels each column group with the time window it covers', async () => {
    renderTable();
    await screen.findByText('Block A1');

    // Günlük is today and Aýlyk is the current month regardless of the period
    // pills — the headers are the only thing saying so.
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
    expect(screen.getByText('Seasonal')).toBeInTheDocument();
    expect(screen.getByText('Export Market')).toBeInTheDocument();
  });
});
