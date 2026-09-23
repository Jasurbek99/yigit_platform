import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import GaplamaTab from './GaplamaTab';

dayjs.extend(isoWeek);

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useSeasonReadOnly', () => ({ useSeasonReadOnly: () => false }));

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><GaplamaTab /></QueryClientProvider>);
}

// Computed from the real clock (no fake timers — GaplamaTab uses TanStack
// Query, whose async resolution doesn't mix well with vi.useFakeTimers()
// without manually advancing them) so the board fixture's date always lands
// inside "this week" (weekOffset 0), whichever day this suite runs on.
const THIS_MONDAY = dayjs().isoWeekday(1).format('YYYY-MM-DD');

describe('GaplamaTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.resolve({
          data: {
            // location / location_name both come from the same backend field
            // (LoadingLocation.name via block.location.name — see
            // apps/export/services/gaplama.py and apps/core/serializers.py's
            // GreenhouseBlockSerializer.location_name) — kept identical here
            // so the location-grouping join in GaplamaTab is actually
            // exercised, not accidentally passed by mismatched casing.
            days: [{ date: THIS_MONDAY, block_id: 1, block_code: 'A', location: 'Dusak',
                     plan_kg: '20000.00', loaded_kg: '12000.00', carried_in_kg: '0.00',
                     available_kg: '8000.00', over_kg: '0.00' }],
            trucks: [],
          },
        });
      }
      if (url.includes('/core/blocks')) {
        return Promise.resolve({
          data: { results: [{ id: 1, code: 'A', name: 'A', parent: null, is_active: true, location_name: 'Dusak' }] },
        });
      }
      if (url.includes('/greenhouse-config')) {
        return Promise.resolve({ data: { truck_capacity_kg: '18500.00', gaplama_carry_days: 2 } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  // react-i18next is mocked with an identity `t`, so accessible names are the
  // raw i18n keys, not the translated Turkish text — matching the convention
  // already used in GaplamaTruckForm.test.tsx (Task 6), which asserts against
  // e.g. 'tir_takip.gaplama.form.open_truck' rather than /Tır Aç/.

  it('renders no writable inputs in the grid for a role with shipment.create', () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    renderTab();
    // The grid itself must render no <input type=number> for plan/available cells —
    // only the (collapsed) Tır Aç form has number inputs, and that form isn't open yet.
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('shows the Tır Aç button for a role with shipment.create', () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    renderTab();
    expect(screen.getByRole('button', { name: /tir_takip\.gaplama\.open_truck/ })).toBeInTheDocument();
  });

  it('hides the Tır Aç button without shipment.create', () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'sales_rep', resource_permissions: { shipment: { create: false } } },
    });
    renderTab();
    expect(screen.queryByRole('button', { name: /tir_takip\.gaplama\.open_truck/ })).not.toBeInTheDocument();
  });

  it('groups the per-location subtotal by GreenhouseBlock.location_name, joined against IGaplamaDay.location', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    const { container } = renderTab();

    // Column order: [label, Mon..Sun, week total]. The board fixture's only
    // row is block 1 / this Monday / available_kg 8000, under location
    // "Dusak" — if the join used the wrong key (e.g. mismatched casing, or
    // grouping by the `location` id instead of `location_name`), this cell
    // would silently read 0 while the block row above it still shows 8000.
    await waitFor(() => {
      const subtotalRow = container.querySelector('tr.sera-gaplama-location-subtotal');
      expect(subtotalRow).not.toBeNull();
      const mondayCell = subtotalRow?.querySelectorAll('td')[1];
      expect(mondayCell?.textContent).toBe('8000');
    });
  });
});
