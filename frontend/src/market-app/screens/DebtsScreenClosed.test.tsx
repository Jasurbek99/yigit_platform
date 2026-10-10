import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import api from '@/services/api';
import { ToastHost } from '../components/ToastHost';
import { hideToast } from '../components/toastStore';
import { debtsFixture } from '../testFixtures';
import type { IBuyerDebt, IDebts } from '../types';
import { debtsClient, mockDebtsApi, renderDebts } from './debts/debtsTestKit';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

function card(name: string): HTMLElement {
  const el = screen.getByRole('heading', { name }).closest('section');
  if (!(el instanceof HTMLElement)) throw new Error(`no card for ${name}`);
  return el;
}

/** Рустам paid everything off: due 0, no sales, his payment still listed. */
function paidOff(): IBuyerDebt {
  const [rustam] = debtsFixture().buyers;
  return { ...rustam, due: '0.00', since: null, sales: [] };
}

describe('DebtsScreen — paid-off buyers and leaving the screen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  afterEach(() => act(() => hideToast()));

  it('shows «Долг закрыт» instead of the sum, no «Принять оплату», and keeps «Удалить»', async () => {
    const [, bakyt] = debtsFixture().buyers;
    mockDebtsApi('agent', { totals: { RUB: '40000.00' }, buyers: [bakyt, paidOff()] });
    renderDebts();
    await screen.findByRole('heading', { name: 'Рустам' });
    const rustam = within(card('Рустам'));
    expect(rustam.getByText('Долг закрыт')).toBeInTheDocument();
    expect(rustam.queryByRole('button', { name: 'Принять оплату' })).not.toBeInTheDocument();
    expect(rustam.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
    expect(card('Рустам').querySelectorAll('.mk-sale')).toHaveLength(0);
    expect(within(card('Бакыт')).getByRole('button', { name: 'Принять оплату' })).toBeInTheDocument();
  });

  it('says nobody owes but still lists the paid-off card for its undo', async () => {
    const debts: IDebts = { totals: {}, buyers: [paidOff()] };
    mockDebtsApi('agent_seller', debts);
    renderDebts();
    expect(await screen.findByText('Долгов нет')).toBeInTheDocument();
    expect(screen.queryByText('Всего должны')).not.toBeInTheDocument();
    expect(within(card('Рустам')).getByText('Долг закрыт')).toBeInTheDocument();
  });

  it('still shows a refused delete after the screen is left', async () => {
    mockDebtsApi('agent_seller');
    let reject: (err: unknown) => void = () => undefined;
    vi.mocked(api.delete).mockReturnValueOnce(new Promise((_, rej) => { reject = rej; }));
    const user = userEvent.setup();
    const client = debtsClient();
    const { rerender } = renderDebts(client);
    await screen.findByRole('heading', { name: 'Рустам' });
    await user.click(within(card('Рустам')).getByRole('button', { name: 'Удалить' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalled());
    // Leave /debts: only the toast host stays mounted.
    rerender(<QueryClientProvider client={client}><ToastHost /></QueryClientProvider>);
    expect(screen.queryByRole('heading', { name: 'Долги клиентов' })).not.toBeInTheDocument();
    await act(async () => {
      reject({ response: { status: 403, data: { error: 'Отменить оплату могут её автор или агент.' } } });
    });
    expect(await screen.findByText('Отменить оплату могут её автор или агент.')).toBeInTheDocument();
  });
});
