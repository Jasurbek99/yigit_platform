import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
const TODAY = dayjs().format('YYYY-MM-DD');
// A day inside the displayed week that's guaranteed NOT to equal `today` —
// used by the edit-cap test below to prove the form resolves the cap from
// the truck's own date, not from `today`, regardless of which day the
// suite actually runs on.
const NOT_TODAY = TODAY === THIS_MONDAY
  ? dayjs(THIS_MONDAY).add(1, 'day').format('YYYY-MM-DD')
  : THIS_MONDAY;

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
      if (url.includes('/core/shipment-options')) {
        return Promise.resolve({ data: { results: [] } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  // react-i18next is mocked with an identity `t`, so accessible names are the
  // raw i18n keys, not the translated Turkish text — matching the convention
  // already used in GaplamaTruckForm.test.tsx (Task 6), which asserts against
  // e.g. 'tir_takip.gaplama.form.open_truck' rather than /Tır Aç/.

  it('renders no writable inputs in the grid for a role with shipment.create', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    const { container } = renderTab();
    // Wait for the grid to actually mount — right after render() the board
    // query hasn't resolved yet and the component is still showing the
    // loading branch, so asserting immediately would pass vacuously without
    // ever having rendered the grid this test is about.
    await waitFor(() => {
      expect(container.querySelector('table.sera-gaplama-grid')).not.toBeNull();
    });
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

  it('resolves the edit-form cap from the truck\'s own date, not from today', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    // Board only has an available_kg row for NOT_TODAY (the truck's own
    // date) — deliberately nothing for TODAY. The pre-fix bug always
    // resolved the edit form's cap against `today`, which would find no
    // matching row here and cap the block at 0 (+ this truck's own 2000 kg
    // = 2000 total). The fix resolves against `editingTruck.date`
    // (NOT_TODAY) and finds the real 8000, for a true cap of 10000.
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.resolve({
          data: {
            days: [{ date: NOT_TODAY, block_id: 1, block_code: 'A', location: 'Dusak',
                     plan_kg: '20000.00', loaded_kg: '0.00', carried_in_kg: '0.00',
                     available_kg: '8000.00', over_kg: '0.00' }],
            trucks: [{
              id: 9, shipment_code: '2109001/26', export_code: null, date: NOT_TODAY,
              status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
              block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 2000 }],
            }],
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
      if (url.includes('/core/shipment-options')) {
        return Promise.resolve({ data: { results: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    renderTab();
    const editButton = await screen.findByRole('button', { name: /tir_takip\.gaplama\.edit/ });
    fireEvent.click(editButton);

    const kgInput = (await screen.findAllByLabelText(/kg/i))[0] as HTMLInputElement;
    expect(kgInput).toHaveValue(2000); // the truck's own current allocation
    fireEvent.change(kgInput, { target: { value: '9000' } }); // > buggy cap (2000), <= fixed cap (10000)
    expect(kgInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('excludes trucks from the carry-days lookback (before Monday) from the truck list', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    // gaplama_carry_days: 2 means the board is fetched from 2 days before
    // Monday — a truck dated the day before Monday is inside that fetch
    // window (so the board API legitimately returns it) but outside the
    // displayed week (`days`). The pre-fix bug rendered `trucks` unfiltered,
    // so this truck would show up in "Açylan tırlar" and inflate the count
    // even though clicking any visible day column could never reveal it.
    const beforeMonday = dayjs(THIS_MONDAY).subtract(1, 'day').format('YYYY-MM-DD');
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.resolve({
          data: {
            days: [],
            trucks: [{
              id: 77, shipment_code: 'CARRY-DAY-TRUCK', export_code: null, date: beforeMonday,
              status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
              block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 1000 }],
            }],
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

    const { container } = renderTab();
    await waitFor(() => {
      expect(container.querySelector('table.sera-gaplama-grid')).not.toBeNull();
    });
    expect(screen.queryByText('CARRY-DAY-TRUCK')).not.toBeInTheDocument();
  });

  it('remounts the form with the clicked truck\'s own data when Üýtget is clicked while the create form is still open', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.resolve({
          data: {
            days: [{ date: THIS_MONDAY, block_id: 1, block_code: 'A', location: 'Dusak',
                     plan_kg: '20000.00', loaded_kg: '0.00', carried_in_kg: '0.00',
                     available_kg: '8000.00', over_kg: '0.00' }],
            trucks: [{
              id: 9, shipment_code: '2109001/26', export_code: null, date: THIS_MONDAY,
              status: 1, status_code: 'draft', status_display: 'Draft', country: null, customer: null,
              block_sources: [{ block_id: 1, block_code: 'A', weight_kg: 3000 }],
            }],
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
      if (url.includes('/core/shipment-options')) {
        return Promise.resolve({ data: { results: [] } });
      }
      if (url.includes('/core/tomato-varieties')) {
        return Promise.resolve({ data: { results: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    renderTab();

    // Open the create form and type into it — nothing here is submitted.
    const openButton = await screen.findByRole('button', { name: /tir_takip\.gaplama\.open_truck/ });
    fireEvent.click(openButton);
    const createKgInput = (await screen.findAllByLabelText(/kg/i))[0] as HTMLInputElement;
    fireEvent.change(createKgInput, { target: { value: '1234' } });
    expect(createKgInput).toHaveValue(1234);

    // Without submitting, click Üýtget on truck 9 (block 1, 3000 kg). Without a
    // `key` on <GaplamaTruckForm>, React would keep the same instance and the
    // form's own useState(initialRows) would never re-run — it would flip to
    // mode="edit" while still showing the stale 1234 from the create row.
    const editButton = await screen.findByRole('button', { name: /tir_takip\.gaplama\.edit/ });
    fireEvent.click(editButton);

    const editKgInput = (await screen.findAllByLabelText(/kg/i))[0] as HTMLInputElement;
    expect(editKgInput).toHaveValue(3000); // truck 9's own allocation, not the leftover 1234
  });
});
