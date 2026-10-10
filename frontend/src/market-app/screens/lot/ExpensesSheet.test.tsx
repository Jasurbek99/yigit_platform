import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import api from '@/services/api';
import { hideToast } from '../../components/toastStore';
import { expenseFixture, lotDetailFixture, lotFixture, oct } from '../../testFixtures';
import { mockLotApi, mockSellerApi, renderLot } from './sellTestKit';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe('ExpensesSheet', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(mockSellerApi);

  afterEach(() => act(() => hideToast()));

  it('checks the rows, posts the filled ones in one request and undoes the whole batch', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        entries: [
          expenseFixture({ id: 11, amount: '5000.00' }),
          expenseFixture({ id: 12, category_id: 5, category_code: 'PARKOVKA', amount: '1000.00' }),
          expenseFixture({ id: 13, category_id: 9, category_code: 'OTHER', label: 'Вода', amount: '200.00' }),
        ],
        lot: lotFixture(),
      },
    });
    vi.mocked(api.delete).mockResolvedValue({ data: { lot: lotFixture() } });
    const user = userEvent.setup();
    renderLot();
    await user.click(await screen.findByRole('button', { name: 'Расходы по машине' }));
    const sheet = within(screen.getByRole('dialog'));
    const save = await sheet.findByRole('button', { name: 'Сохранить расходы' });

    await user.click(save);
    expect(sheet.getByRole('alert')).toHaveTextContent('Напишите хотя бы одну сумму.');

    await user.type(sheet.getByLabelText('Комиссия'), '5000');
    expect(sheet.getByLabelText('Комиссия')).toHaveValue('5 000');
    await user.type(sheet.getByLabelText('Парковка'), '1000');
    await user.type(sheet.getByLabelText('Сумма'), '200');
    expect(sheet.getByText(/^6\s200\s₸$/)).toBeInTheDocument();
    await user.click(save);
    expect(sheet.getByRole('alert')).toHaveTextContent('Напишите название расхода.');
    expect(api.post).not.toHaveBeenCalled();

    await user.type(sheet.getByLabelText('Другой расход'), 'Вода');
    await user.click(save);
    expect(await screen.findByText(/^Расходы: 3 записи, 6\s200\s₸$/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/market/lots/5/expenses/', {
      rows: [
        { category_id: 3, amount: '5000.00' },
        { category_id: 5, amount: '1000.00' },
        { category_id: 9, amount: '200.00', label: 'Вода' },
      ],
    }, expect.anything());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(3));
    [11, 12, 13].forEach((id) => {
      expect(api.delete).toHaveBeenCalledWith(`/market/lots/5/expenses/${id}/`, expect.anything());
    });
  });

  it('still offers «Расходы по машине» to the seller of a closed truck', async () => {
    mockLotApi('agent_seller', { ...lotDetailFixture(), closed_at: oct(8, 16) });
    renderLot();
    expect(await screen.findByText('Машина закрыта. Ящиков не осталось.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Расходы по машине' })).toBeInTheDocument();
  });

  it('does not offer it to the agent, who records no expenses', async () => {
    mockLotApi('agent', { ...lotDetailFixture(), closed_at: oct(8, 16) });
    renderLot();
    expect(await screen.findByText('Машина закрыта. Ящиков не осталось.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Расходы по машине' })).not.toBeInTheDocument();
  });
});
