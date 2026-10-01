import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from 'antd';
import i18n from '@/i18n';
import * as drafts from '@/hooks/useDrafts';
import { ShipmentPackingActions, packingActions } from './ShipmentPackingActions';
import { swapCandidates } from './SwapPackingModal';
import type { IShipmentDetail, IShipmentDraft } from '@/types';

vi.mock('@/hooks/useDrafts');
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'export_manager' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const joinManager = { role: 'export_manager' };
const base = {
  id: 4, shipment_code: '0101004/26', status_code: 'draft', country: 1, customer: 2,
  block_sources: [{ block_code: 'A', block_name: 'A', weight_kg: 1000, harvest_date: null }],
} as unknown as IShipmentDetail;

describe('packingActions', () => {
  it('allows both before loading with packing and a destination', () => {
    expect(packingActions(base, joinManager)).toEqual({ canSwap: true, canUnjoin: true });
  });

  it('no unjoin without a customer (a supply plan — the backend refuses it)', () => {
    expect(packingActions({ ...base, customer: null }, joinManager)).toEqual({ canSwap: true, canUnjoin: false });
  });

  it('nothing after loading started, without packing, or for a role outside JOIN_ROLES', () => {
    const none = { canSwap: false, canUnjoin: false };
    expect(packingActions({ ...base, status_code: 'yuklenme' }, joinManager)).toEqual(none);
    expect(packingActions({ ...base, block_sources: [] }, joinManager)).toEqual(none);
    expect(packingActions(base, { role: 'sales_rep' })).toEqual(none);
  });
});

describe('swap candidates', () => {
  it('drops the current row, rows without packing and rows past loading', () => {
    const row = (id: number, status: string, blocks: number) => ({
      id, shipment_code: `c${id}`, status_code: status, block_sources: Array(blocks).fill({ block_code: 'A' }),
    }) as unknown as IShipmentDraft;
    const out = swapCandidates(
      [row(4, 'draft', 1), row(5, 'draft', 0), row(6, 'yuklenme', 1), row(7, 'gumruk_girish', 1)], 4,
    );
    expect(out.map((r) => r.id)).toEqual([7]);
  });
});

describe('ShipmentPackingActions', () => {
  function setup(readOnly = false) {
    const unjoin = { mutate: vi.fn(), isPending: false };
    vi.mocked(drafts.useUnjoinPackaging).mockReturnValue(unjoin as unknown as ReturnType<typeof drafts.useUnjoinPackaging>);
    vi.mocked(drafts.useSwapPackaging).mockReturnValue(
      { mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof drafts.useSwapPackaging>,
    );
    vi.mocked(drafts.useJoinBoard).mockReturnValue(
      { data: [], isLoading: false } as unknown as ReturnType<typeof drafts.useJoinBoard>,
    );
    render(<ShipmentPackingActions shipment={base} readOnly={readOnly} />);
    return unjoin;
  }

  it('unjoins after confirmation', () => {
    const confirm = vi.spyOn(Modal, 'confirm').mockImplementation((cfg) => {
      cfg.onOk?.();
      return { destroy: vi.fn(), update: vi.fn() } as unknown as ReturnType<typeof Modal.confirm>;
    });
    const unjoin = setup();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('packing.btn_unjoin') }));
    expect(unjoin.mutate).toHaveBeenCalledWith(4, expect.anything());
    confirm.mockRestore();
  });

  it('opens the swap picker', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('packing.btn_swap') }));
    expect(screen.getByText(i18n.t('shipment_detail.parts.swap_empty'))).toBeInTheDocument();
  });

  it('renders nothing read-only', () => {
    setup(true);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
