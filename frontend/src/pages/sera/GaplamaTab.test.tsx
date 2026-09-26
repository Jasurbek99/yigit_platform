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
// useDrafts() (added 2026-09-24 for edit-mode batch seeding — see
// task-7-report.md) pulls in useSelectedSeason(), which calls
// react-router-dom's useSearchParams() — this test file has no <Router>
// ancestor. Same fixed-season mock pattern already used elsewhere for this
// exact reason (e.g. useSheetLiveSync.test.tsx).
vi.mock('@/hooks/useSeasonParam', () => ({
  useSelectedSeason: () => ({ seasonId: 1, isReady: true }),
}));

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

// Task 6 numbers get a thousands separator (toLocaleString('ru-RU'), which
// inserts a non-breaking/narrow space every 3 digits — "2 000", not "2000").
// Strip every non-digit before comparing so the underlying kg value being
// asserted never has to change, only how a test reads formatted text.
function digits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

// The day-stepper (◀ current-day ▶, Task 6) moves `selectedDay` one day at a
// time and only rolls `weekOffset` on crossing a week boundary — walking one
// click at a time (rather than jumping) exercises exactly that same path a
// real user's clicks would.
async function stepToDay(target: string) {
  const start = screen.getByTestId('gaplama-current-day').getAttribute('data-day') ?? '';
  let cursor = dayjs(start);
  const targetDay = dayjs(target);
  const forward = targetDay.isAfter(cursor, 'day');
  const button = screen.getByRole('button', { name: forward ? '▶' : '◀' });
  while (!cursor.isSame(targetDay, 'day')) {
    fireEvent.click(button);
    cursor = forward ? cursor.add(1, 'day') : cursor.subtract(1, 'day');
    await waitFor(() => {
      expect(screen.getByTestId('gaplama-current-day').getAttribute('data-day')).toBe(cursor.format('YYYY-MM-DD'));
    });
  }
}

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
    // Task 6: the per-day location-subtotal-by-column layout lives in the
    // week grid now (day mode shows exactly one day, with its own subtotal
    // row scoped to that single day) — switch modes to reach it.
    fireEvent.click(await screen.findByRole('button', { name: /tir_takip\.gaplama\.mode_week/ }));

    // Column order: [label, Mon..Sun, week total]. The board fixture's only
    // row is block 1 / this Monday / available_kg 8000, under location
    // "Dusak" — if the join used the wrong key (e.g. mismatched casing, or
    // grouping by the `location` id instead of `location_name`), this cell
    // would silently read 0 while the block row above it still shows 8000.
    await waitFor(() => {
      const subtotalRow = container.querySelector('tr.sera-gaplama-location-subtotal');
      expect(subtotalRow).not.toBeNull();
      const mondayCell = subtotalRow?.querySelectorAll('td')[1];
      expect(digits(mondayCell?.textContent)).toBe('8000');
    });
  });

  it('resolves the edit-form cap from the truck\'s own date, not from today', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true, edit: true } } },
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

  // I3: Üýtget writes through TWO server-side gates (POST block-sources
  // needs shipment.create, PATCH weight_net needs shipment.edit). A role
  // with create but not edit must not see the button at all — otherwise it
  // could rewrite the truck's split and then 403 on the weight sync,
  // leaving a half-saved truck.
  it('hides the Üýtget button for a role with shipment.create but not shipment.edit', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true, edit: false } } },
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
      return Promise.resolve({ data: {} });
    });

    renderTab();
    await waitFor(() => {
      expect(screen.getByText('2109001/26')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /tir_takip\.gaplama\.edit/ })).not.toBeInTheDocument();
  });

  // I4: a failed board query must render a visible error, not silently fall
  // through the `?? 0` fallbacks into an all-zero grid that reads as a real
  // (wrong) "nothing available to pack" answer.
  it('renders an error message instead of a zero-filled grid when the board query fails', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.reject(new Error('network error'));
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
      expect(screen.getByText('tir_takip.gaplama.error_load')).toBeInTheDocument();
    });
    expect(container.querySelector('table.sera-gaplama-grid')).toBeNull();
  });

  // 2026-09-23 addendum: the server does its own gaplama_carry_days lookback
  // internally (walk_start = from_date - carry_days) regardless of what
  // from_date the client sends — the client widening its own request was
  // redundant, and inflated week_totals' summed fields with days outside the
  // displayed week. Fixed: the client now asks for exactly [Monday, Sunday].
  it('requests from_date=Monday, not Monday minus gaplama_carry_days', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    renderTab();
    await waitFor(() => {
      const call = (api.get as any).mock.calls.find(([url]: [string]) => url.includes('/export/gaplama/board/'));
      expect(call?.[0]).toContain(`from_date=${THIS_MONDAY}`);
    });
  });

  // I1 (final review): a remainder that stays live for several days used to
  // get summed once per day it appeared in, inflating the week-total column.
  // The fix reads week_totals.available_kg (the server's already-correct,
  // non-duplicated last-day figure) instead of summing available_kg itself.
  it('reads the per-block week-total cell from week_totals, not a sum of available_kg across days', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    const tuesday = dayjs(THIS_MONDAY).add(1, 'day').format('YYYY-MM-DD');
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.resolve({
          data: {
            // Same remainder alive on both days -- summing available_kg
            // across them would (wrongly) read 16000; week_totals says 8000.
            days: [
              { date: THIS_MONDAY, block_id: 1, block_code: 'A', location: 'Dusak',
                plan_kg: '8000.00', loaded_kg: '0.00', carried_in_kg: '0.00',
                carry_in_breakdown: [], available_kg: '8000.00', over_kg: '0.00', carried_out_kg: '8000.00' },
              { date: tuesday, block_id: 1, block_code: 'A', location: 'Dusak',
                plan_kg: '0.00', loaded_kg: '0.00', carried_in_kg: '8000.00',
                carry_in_breakdown: [{ origin_date: THIS_MONDAY, kg: '8000.00' }],
                available_kg: '8000.00', over_kg: '0.00', carried_out_kg: '0.00' },
            ],
            trucks: [],
            week_totals: [{ block_id: 1, block_code: 'A', location: 'Dusak',
                            plan_kg: '8000.00', loaded_kg: '0.00', over_kg: '0.00', available_kg: '8000.00' }],
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
    // Task 6: the trailing week-total column only exists on the week grid.
    fireEvent.click(await screen.findByRole('button', { name: /tir_takip\.gaplama\.mode_week/ }));
    await waitFor(() => {
      const row = container.querySelector('tbody tr:not(.sera-gaplama-location-header):not(.sera-gaplama-location-subtotal)');
      const weekCell = row?.querySelectorAll('td')[row.querySelectorAll('td').length - 1];
      expect(digits(weekCell?.textContent)).toBe('8000');
    });
  });

  it('shows a carry-in tooltip naming the origin day, and a carry-out marker', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.resolve({
          data: {
            days: [{ date: THIS_MONDAY, block_id: 1, block_code: 'A', location: 'Dusak',
                     plan_kg: '5000.00', loaded_kg: '0.00', carried_in_kg: '2000.00',
                     carry_in_breakdown: [{ origin_date: '2026-01-01', kg: '2000.00' }],
                     available_kg: '7000.00', over_kg: '0.00', carried_out_kg: '7000.00' }],
            trucks: [],
            week_totals: [],
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
    // Task 6: day mode's own "Geçen" (carried-in) column keeps the
    // carry-in tooltip and class — the week grid folds all four stacked
    // numbers into one title attribute instead (brief Step 5), so this
    // data only has a dedicated element in day mode. The fixture is dated
    // THIS_MONDAY, not necessarily today (whichever day the suite runs),
    // so navigate the day stepper there first.
    await screen.findByRole('columnheader', { name: /tir_takip\.gaplama\.available/ });
    await stepToDay(THIS_MONDAY);
    await waitFor(() => {
      const carryIn = container.querySelector('.sera-gaplama-carry-in');
      expect(digits(carryIn?.textContent)).toBe('2000');
      expect(carryIn?.getAttribute('title')).toContain('01.01');
      // Round-1 fix: carried_out_kg is its own labelled column (Galýar,
      // immediately after Geçen), not a second number stacked inside the
      // Boş cell — the whole point of the day table is one number per
      // cell, label in the header.
      const carryOut = carryIn?.nextElementSibling;
      expect(digits(carryOut?.textContent)).toBe('7000');
    });
  });

  it('excludes trucks from the carry-days lookback (before Monday) from the truck list', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    // The board endpoint's OWN internal lookback (walk_start = from_date -
    // gaplama_carry_days, inside build_gaplama_board) can still legitimately
    // return a truck dated before the requested from_date on a real backend
    // response shape, even though the client no longer asks for that range
    // itself — this test pins the defensive client-side filter that keeps
    // such a row out of the displayed week's truck list regardless.
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
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true, edit: true } } },
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

  // Gap 3 (task-7-report.md): `+ Tır Aç` must open a truck dated the day
  // being VIEWED (the day stepper's selectedDay), not real "today" — a
  // manager stepping forward to Thursday and opening a truck there must not
  // silently get one dated today.
  it('opens a create truck dated the currently-selected day, not real today', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.resolve({
          data: {
            days: [
              { date: THIS_MONDAY, block_id: 1, block_code: 'A', location: 'Dusak',
                plan_kg: '20000.00', loaded_kg: '0.00', carried_in_kg: '0.00',
                available_kg: '8000.00', over_kg: '0.00' },
              { date: NOT_TODAY, block_id: 1, block_code: 'A', location: 'Dusak',
                plan_kg: '20000.00', loaded_kg: '0.00', carried_in_kg: '0.00',
                available_kg: '8000.00', over_kg: '0.00' },
            ],
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
      if (url.includes('/core/tomato-varieties')) {
        return Promise.resolve({ data: { results: [] } });
      }
      return Promise.resolve({ data: {} });
    });
    (api.post as any).mockResolvedValue({ data: { id: 1, shipment_code: '2109001/26' } });

    renderTab();
    await stepToDay(NOT_TODAY);

    const openButton = await screen.findByRole('button', { name: /tir_takip\.gaplama\.open_truck/ });
    fireEvent.click(openButton);
    const kgInput = (await screen.findAllByLabelText(/kg/i))[0] as HTMLInputElement;
    fireEvent.change(kgInput, { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /tir_takip\.gaplama\.form\.open_truck/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = (api.post as any).mock.calls[0];
    expect(body.date).toBe(NOT_TODAY);
  });

  // 2026-09-25: per-date leftover picking removed (owner + loading/packaging
  // head — leftover crates are physically mixed in the hall, so a per-date
  // pick has no counterpart on the floor). buildBatchesByBlock must collapse
  // every live carry-in bucket into ONE leftover row, capped at their sum,
  // instead of one row per origin date.
  it('collapses three live carry-in buckets into one leftover row capped at their sum', async () => {
    (useAuth as any).mockReturnValue({
      user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
    });
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/export/gaplama/board/')) {
        return Promise.resolve({
          data: {
            // Dated real TODAY, not THIS_MONDAY: `openCreateForm` builds the
            // form against `selectedDay`, which initializes to real today,
            // not the displayed week's Monday.
            days: [{ date: TODAY, block_id: 1, block_code: 'A', location: 'Dusak',
                     plan_kg: '9000.00', loaded_kg: '0.00', carried_in_kg: '4500.00',
                     carry_in_breakdown: [
                       { origin_date: '2026-09-18', kg: '1000.00', age_days: 6 },
                       { origin_date: '2026-09-20', kg: '2000.00', age_days: 4 },
                       { origin_date: '2026-09-22', kg: '1500.00', age_days: 2 },
                     ],
                     available_kg: '13500.00', over_kg: '0.00', carried_out_kg: '0.00' }],
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
        return Promise.resolve({ data: { truck_capacity_kg: '18500.00', gaplama_carry_days: 7 } });
      }
      if (url.includes('/core/shipment-options')) {
        return Promise.resolve({ data: { results: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    renderTab();
    const openButton = await screen.findByRole('button', { name: /tir_takip\.gaplama\.open_truck/ });
    fireEvent.click(openButton);

    // Two rows total: the collapsed leftover (4500 = 1000+2000+1500) and
    // today's own plan (9000) — never three, one per origin date.
    const inputs = await screen.findAllByLabelText(/kg/i);
    expect(inputs).toHaveLength(2);
    const caps = document.querySelectorAll('.sera-gaplama-form-cap');
    expect(Array.from(caps).map((c) => c.textContent)).toEqual(['4500', '9000']);
  });

  // ─── Task 6: one table, a day mode and a week mode ──────────────────────
  // The suite mocks react-i18next's `t` as the identity function (line ~13
  // above) — every existing test in this file matches accessible names
  // against the raw `tir_takip.gaplama.*` key path, never translated Turkmen
  // text, because that's literally all `t()` returns under this mock. The
  // task-6-brief.md's own draft of these three tests asserts against
  // translated Turkmen substrings (/Boş/i, /Gün/i, /Hepde/i, /boş ýok/i),
  // which cannot pass under this file's mock without hardcoding Turkmen text
  // outside t() — forbidden by the i18n rule. Adapted to the file's real
  // convention instead; the underlying behavior asserted is unchanged.
  describe('day/week mode (Task 6)', () => {
    it('opens on the day mode with the block rows, not the week grid', async () => {
      renderTab();
      expect(await screen.findByRole('columnheader', { name: /tir_takip\.gaplama\.available/ })).toBeInTheDocument();
      // The week grid's date columns must not be on screen in day mode.
      const mondayHeader = dayjs(THIS_MONDAY).format('DD.MM');
      expect(screen.queryByRole('columnheader', { name: new RegExp(mondayHeader.replace('.', '\\.')) }))
        .not.toBeInTheDocument();
    });

    it('switches to the week grid and back', async () => {
      renderTab();
      await screen.findByRole('columnheader', { name: /tir_takip\.gaplama\.available/ });
      const mondayHeader = new RegExp(dayjs(THIS_MONDAY).format('DD.MM').replace('.', '\\.'));

      fireEvent.click(screen.getByRole('button', { name: /tir_takip\.gaplama\.mode_week/ }));
      expect(await screen.findByRole('columnheader', { name: mondayHeader })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /tir_takip\.gaplama\.mode_day/ }));
      await waitFor(() => {
        expect(screen.queryByRole('columnheader', { name: mondayHeader })).not.toBeInTheDocument();
      });
    });

    // Round-1 fix: the two-colour rule (green = a whole truck available, red
    // = overloaded) is the day table's entire decision aid and had no test
    // pinning it. Asserts on the class, not on text.
    it('colours the Boş cell green at a full truck, red when overloaded, and plain in between', async () => {
      (useAuth as any).mockReturnValue({
        user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
      });
      (api.get as any).mockImplementation((url: string) => {
        if (url.includes('/export/gaplama/board/')) {
          return Promise.resolve({
            data: {
              days: [
                { date: TODAY, block_id: 1, block_code: 'A', location: 'Dusak',
                  plan_kg: '0.00', loaded_kg: '0.00', carried_in_kg: '0.00',
                  available_kg: '18500.00', over_kg: '0.00' },
                { date: TODAY, block_id: 2, block_code: 'B', location: 'Dusak',
                  plan_kg: '0.00', loaded_kg: '0.00', carried_in_kg: '0.00',
                  available_kg: '0.00', over_kg: '500.00' },
                { date: TODAY, block_id: 3, block_code: 'C', location: 'Dusak',
                  plan_kg: '0.00', loaded_kg: '0.00', carried_in_kg: '0.00',
                  available_kg: '5000.00', over_kg: '0.00' },
              ],
              trucks: [],
            },
          });
        }
        if (url.includes('/core/blocks')) {
          return Promise.resolve({
            data: { results: [
              { id: 1, code: 'A', name: 'A', parent: null, is_active: true, location_name: 'Dusak', carry_days: 7 },
              { id: 2, code: 'B', name: 'B', parent: null, is_active: true, location_name: 'Dusak', carry_days: 7 },
              { id: 3, code: 'C', name: 'C', parent: null, is_active: true, location_name: 'Dusak', carry_days: 7 },
            ] },
          });
        }
        if (url.includes('/greenhouse-config')) {
          return Promise.resolve({ data: { truck_capacity_kg: '18500.00', gaplama_carry_days: 2 } });
        }
        return Promise.resolve({ data: {} });
      });

      const { container } = renderTab();
      await screen.findByRole('columnheader', { name: /tir_takip\.gaplama\.available/ });

      function bosCellFor(blockName: string): Element | null | undefined {
        const nameCell = Array.from(container.querySelectorAll('td.sera-gaplama-block-name'))
          .find((td) => td.textContent?.startsWith(blockName));
        return nameCell?.parentElement?.querySelectorAll('td')[1];
      }

      await waitFor(() => {
        expect(bosCellFor('A')).toHaveClass('sera-gaplama-cell-full');
        expect(bosCellFor('B')).toHaveClass('sera-gaplama-cell-over');
        expect(bosCellFor('C')?.className).toBe('');
      });
    });

    it('folds away blocks with nothing available', async () => {
      (useAuth as any).mockReturnValue({
        user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
      });
      // Dated TODAY (not THIS_MONDAY) — day mode opens on today by default,
      // so this fixture needs no day-stepper navigation. Block B has no row
      // at all for today: the fold rule (isEmpty) treats a missing row the
      // same as an available_kg-and-over_kg-both-zero row.
      (api.get as any).mockImplementation((url: string) => {
        if (url.includes('/export/gaplama/board/')) {
          return Promise.resolve({
            data: {
              days: [{ date: TODAY, block_id: 1, block_code: 'A', location: 'Dusak',
                       plan_kg: '20000.00', loaded_kg: '12000.00', carried_in_kg: '0.00',
                       available_kg: '8000.00', over_kg: '0.00' }],
              trucks: [],
            },
          });
        }
        if (url.includes('/core/blocks')) {
          return Promise.resolve({
            data: { results: [
              { id: 1, code: 'A', name: 'A', parent: null, is_active: true, location_name: 'Dusak', carry_days: 7 },
              { id: 2, code: 'B', name: 'B', parent: null, is_active: true, location_name: 'Dusak', carry_days: 7 },
            ] },
          });
        }
        if (url.includes('/greenhouse-config')) {
          return Promise.resolve({ data: { truck_capacity_kg: '18500.00', gaplama_carry_days: 2 } });
        }
        return Promise.resolve({ data: {} });
      });

      const { container } = renderTab();
      const foldedRow = await screen.findByText(/tir_takip\.gaplama\.folded_blocks/);
      // Exactly block B folded — block A has kg and stays a normal row.
      // The count itself (`{{count}}`) isn't readable under the identity `t`
      // mock (it only echoes the key, not the interpolated value), so the
      // count is verified structurally instead, via the expanded rows below.
      expect(screen.getByText('A')).toBeInTheDocument();
      expect(container.querySelectorAll('tr.sera-gaplama-folded-block')).toHaveLength(0);

      fireEvent.click(foldedRow);
      await waitFor(() => {
        expect(container.querySelectorAll('tr.sera-gaplama-folded-block')).toHaveLength(1);
      });
      expect(await screen.findByText(/^B /)).toBeInTheDocument();
    });

    // Task 6 review fix: the day-stepper is the ONLY navigation control left
    // (prev/this/next-week buttons were removed) — in week mode it must move
    // a whole week per click, or a user could never reach next week without
    // seven clicks.
    it('steps a whole week per click while in week mode', async () => {
      (useAuth as any).mockReturnValue({
        user: { role: 'loading_dept_head', resource_permissions: { shipment: { create: true } } },
      });
      renderTab();
      fireEvent.click(await screen.findByRole('button', { name: /tir_takip\.gaplama\.mode_week/ }));
      (api.get as any).mockClear();
      fireEvent.click(screen.getByRole('button', { name: '▶' }));
      const nextMonday = dayjs(THIS_MONDAY).add(7, 'day').format('YYYY-MM-DD');
      await waitFor(() => {
        const call = (api.get as any).mock.calls.find(([url]: [string]) => url.includes('/export/gaplama/board/'));
        expect(call?.[0]).toContain(`from_date=${nextMonday}`);
      });
    });
  });
});
