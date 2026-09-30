import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import i18n from '@/i18n';
import GatePage from './GatePage';
import { useGateAction, useGateBoard } from '@/hooks/useGate';
import { useAuth } from '@/hooks/useAuth';
import { useLoadingLocations } from '@/hooks/useAdmin';
import type { IGateBoard, IGateRow } from '@/types';

vi.mock('@/hooks/useGate', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useGate')>()),
  useGateBoard: vi.fn(),
  useGateAction: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useAdmin', () => ({ useLoadingLocations: vi.fn() }));

const mutate = vi.fn();

function row(overrides: Partial<IGateRow> = {}): IGateRow {
  return {
    id: 1, shipment_code: '0000001/26', truck_plate: '1535AKM', truck_plate_2: '2256TAH',
    driver_name: 'Aman', driver_phone: '+99365000000', date: '2099-01-01',
    is_gapy_satys: false, status_code: 'gumruk_chykysh', greenhouse_arrived_at: null,
    departed_at: null, can_undo: false, ...overrides,
  };
}

// A real garawul always holds resource_permissions.gate.edit (seeded by
// core/0067) — canDo needs it explicitly now that GatePage computes
// primaryAction/undoAction from canDo instead of assuming every guard may
// act (final-fix review F9).
const GATE_EDIT = { gate: { view: true, create: true, edit: true, delete: true } };

function setup(board: Partial<IGateBoard> = {}, error: unknown = null) {
  vi.mocked(useAuth).mockReturnValue({
    user: { role: 'garawul', resource_permissions: GATE_EDIT },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useLoadingLocations).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useLoadingLocations>);
  vi.mocked(useGateAction).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useGateAction>);
  vi.mocked(useGateBoard).mockReturnValue({
    data: error ? undefined : {
      location: { id: 1, name: 'Dusak' }, expected: [], inside: [], recently_left: [], ...board,
    },
    isLoading: false,
    isError: Boolean(error),
    error,
  } as unknown as ReturnType<typeof useGateBoard>);
  return render(<GatePage />);
}

describe('GatePage', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows expected trucks with a count and confirms before marking arrival', () => {
    setup({ expected: [row()] });
    expect(screen.getByText('Expected (1)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Arrived at greenhouse' }));
    expect(mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Truck 1535AKM arrived at the greenhouse?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, confirm' }));
    expect(mutate).toHaveBeenCalledWith(
      { id: 1, action: 'arrive', locationId: null }, expect.any(Object),
    );
  });

  it('filters by plate typed on a Russian keyboard', () => {
    setup({ expected: [row(), row({ id: 2, truck_plate: '9999BBB', truck_plate_2: null })] });
    fireEvent.change(screen.getByPlaceholderText('Search plate'), { target: { value: 'акм' } });
    expect(screen.getByTestId('gate-card-1')).toBeInTheDocument();
    expect(screen.queryByTestId('gate-card-2')).not.toBeInTheDocument();
  });

  it('offers undo only while the server allows it', () => {
    setup({ inside: [row({ id: 3, can_undo: true }), row({ id: 4, can_undo: false })] });
    fireEvent.click(screen.getByRole('radio', { name: 'Inside (2)' }));
    expect(within(screen.getByTestId('gate-card-3')).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(within(screen.getByTestId('gate-card-4')).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('explains a guard without a location', () => {
    const error = new AxiosError('bad', '400', undefined, undefined, {
      status: 400, statusText: 'Bad Request', headers: {}, config: { headers: new AxiosHeaders() },
      data: { error: 'no_location' },
    });
    setup({}, error);
    expect(screen.getByText('No location assigned to you — contact the admin.')).toBeInTheDocument();
  });

  it('a user without gate edit sees cards but no buttons (F9)', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { role: 'export_manager', resource_permissions: {} },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useLoadingLocations).mockReturnValue({ data: [{ id: 1, name: 'Dusak' }] } as unknown as ReturnType<typeof useLoadingLocations>);
    vi.mocked(useGateAction).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useGateAction>);
    vi.mocked(useGateBoard).mockReturnValue({
      data: { location: { id: 1, name: 'Dusak' }, expected: [row()], inside: [], recently_left: [] },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useGateBoard>);
    render(<GatePage />);
    expect(screen.getByTestId('gate-card-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Arrived at greenhouse' })).not.toBeInTheDocument();
  });

  it('keeps the list on a poll failure instead of blanking it (F11)', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { role: 'garawul', resource_permissions: GATE_EDIT },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useLoadingLocations).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useLoadingLocations>);
    vi.mocked(useGateAction).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useGateAction>);
    vi.mocked(useGateBoard).mockReturnValue({
      data: { location: { id: 1, name: 'Dusak' }, expected: [row()], inside: [], recently_left: [] },
      isLoading: false,
      isError: true,
      error: new Error('network blip'),
    } as unknown as ReturnType<typeof useGateBoard>);
    render(<GatePage />);
    expect(screen.getByTestId('gate-card-1')).toBeInTheDocument();
    expect(screen.getByText('List not refreshed — check the connection')).toBeInTheDocument();
  });
});
