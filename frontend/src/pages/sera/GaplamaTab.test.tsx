import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import GaplamaTab from './GaplamaTab';

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useSeasonReadOnly', () => ({ useSeasonReadOnly: () => false }));

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><GaplamaTab /></QueryClientProvider>);
}

describe('GaplamaTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.resolve({
          data: {
            days: [{ date: '2026-09-21', block_id: 1, block_code: 'A', location: 'dusak',
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
});
