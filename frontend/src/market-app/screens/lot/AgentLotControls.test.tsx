import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import api from '@/services/api';
import { lotDetailFixture, lotFixture, page } from '../../testFixtures';
import type { ILotDetail } from '../../types';
import { renderLot } from './sellTestKit';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const ME = { role: 'agent', username: 'serik', first_name: 'Серик', customer: null, bazaar: null };
const SELLERS = [
  { id: 7, username: 'aidos', first_name: 'Айдос', last_name: '', is_active: true, bazaar: { id: 1, name: 'Зелёный' } },
  { id: 8, username: 'nurlan', first_name: 'Нурлан', last_name: '', is_active: true, bazaar: { id: 2, name: 'Алтын Орда' } },
  { id: 9, username: 'old', first_name: 'Бывший', last_name: '', is_active: false, bazaar: null },
];

/** The agent looking at lot 5 (`detail`), with the team's sellers. */
function mockAgentApi(detail: ILotDetail): void {
  [api.get, api.post, api.patch, api.delete].forEach((fn) => vi.mocked(fn).mockReset());
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/market/team/sellers/') return Promise.resolve(page(SELLERS));
    return Promise.resolve({ data: url === '/market/me/' ? ME : url.includes('/lots/') ? detail : [] });
  });
}

/** A truck whose shipment had no box count: the placeholder 1 and nothing sold. */
function pendingLot(): ILotDetail {
  return { ...lotDetailFixture(), boxes_received: 1, needs_receipt: true, sales: [], expenses: [] };
}

describe('agent controls on the lot', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(() => mockAgentApi(lotDetailFixture()));

  it('asks for the receipt and PATCHes the counts and the changed tare once on a double press', async () => {
    mockAgentApi(pendingLot());
    vi.mocked(api.patch).mockResolvedValueOnce({
      data: lotFixture({ boxes_received: 120, tare_g: 500, needs_receipt: false }),
    });
    const user = userEvent.setup();
    renderLot();
    const prompt = 'Укажите, сколько ящиков и сколько ящиков в паллете пришло';
    expect(await screen.findByText(prompt)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить продажу' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Приёмка' }));
    const dialog = screen.getByRole('dialog');
    const boxes = within(dialog).getByLabelText('Сколько ящиков пришло');
    expect(boxes).toHaveValue('');
    await user.type(boxes, '12a0');
    const pallet = within(dialog).getByLabelText('Ящиков на одной паллете');
    expect(pallet).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(api.patch).not.toHaveBeenCalled();
    await user.type(pallet, '60');
    const tare = within(dialog).getByLabelText('Вес пустого ящика, г');
    await user.clear(tare);
    await user.type(tare, '500');
    const save = within(dialog).getByRole('button', { name: 'Сохранить' });
    act(() => {
      save.click();
      save.click();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith(
      '/market/lots/5/', { boxes_received: 120, boxes_per_pallet: 60, tare_g: 500 }, expect.anything(),
    );
    expect(screen.queryByText(prompt)).not.toBeInTheDocument();
  });

  it('shows «Уже продано…» under the boxes field and keeps the sheet open', async () => {
    const message = 'Уже продано или списано: 32 ящиков. Меньше поставить нельзя.';
    vi.mocked(api.patch).mockRejectedValueOnce({ response: { status: 400, data: { error: message } } });
    const user = userEvent.setup();
    renderLot();
    await user.click(await screen.findByRole('button', { name: 'Приёмка' }));
    const dialog = screen.getByRole('dialog');
    const boxes = within(dialog).getByLabelText('Сколько ящиков пришло');
    expect(boxes).toHaveValue('100');
    await user.clear(boxes);
    await user.type(boxes, '20');
    await user.type(within(dialog).getByLabelText('Цена за 1 кг по умолчанию, ₸'), '45,5');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    const error = await within(dialog).findByText(message);
    expect(boxes).toHaveAttribute('aria-describedby', error.id);
    expect(api.patch).toHaveBeenCalledWith(
      '/market/lots/5/', { boxes_received: 20, default_price_kg: '45.50' }, expect.anything(),
    );
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeEnabled();
  });

  it('closes without a request when nothing changed', async () => {
    const user = userEvent.setup();
    renderLot();
    await user.click(await screen.findByRole('button', { name: 'Приёмка' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('assigns another seller, then none', async () => {
    vi.mocked(api.patch)
      .mockResolvedValueOnce({ data: lotFixture({ seller: { id: 8, name: 'Нурлан' } }) })
      .mockResolvedValueOnce({ data: lotFixture({ seller: null }) });
    const user = userEvent.setup();
    renderLot();
    await user.click(await screen.findByRole('button', { name: 'Продавец: Айдос' }));
    let dialog = screen.getByRole('dialog');
    const select = await within(dialog).findByLabelText('Продавец');
    expect(within(select).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Без продавца', 'Айдос, Зелёный', 'Нурлан, Алтын Орда']);
    await user.selectOptions(select, '8');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/market/lots/5/', { seller_id: 8 }, expect.anything()));
    await user.click(await screen.findByRole('button', { name: 'Продавец: Нурлан' }));
    dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Продавец'), '');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/market/lots/5/', { seller_id: null }, expect.anything()));
    expect(await screen.findByRole('button', { name: 'Продавец: не назначен' })).toBeInTheDocument();
  });
});
