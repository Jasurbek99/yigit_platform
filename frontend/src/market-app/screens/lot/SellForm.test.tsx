import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import api from '@/services/api';
import { hideToast } from '../../components/toastStore';
import { lotFixture } from '../../testFixtures';
import { fillSale, mockSellerApi, renderLot, saved } from './sellTestKit';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe('SellForm', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(mockSellerApi);

  afterEach(() => act(() => hideToast()));

  it('saves a sale, resets the form, and undoes it from the toast', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(saved());
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { lot: lotFixture() } });
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    expect(screen.getByText('Чистый вес: 100 кг (минус 10 ящиков по 450 г)')).toBeInTheDocument();
    expect(screen.getByLabelText('Итого, ₸ (можно исправить)')).toHaveValue('4 500');

    const save = screen.getByRole('button', { name: 'Сохранить продажу' });
    act(() => { save.click(); save.click(); }); // same tick: the second press must not post again
    expect(await screen.findByText(/^Сохранено: 10 ящиков, 100 кг, 4\s500\s₸$/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/market/lots/5/sales/',
      { unit: 'box', qty: 10, gross_kg: '104.50', price_kg: '45.00', paid_on_spot: true }, expect.anything());
    expect(save).toBeDisabled();
    expect(screen.getByLabelText('Сколько ящиков?')).toHaveValue('1');
    expect(screen.getByLabelText('Вес с ящиками, кг')).toHaveValue('');
    expect(screen.getByLabelText('Цена за 1 кг, ₸')).toHaveValue('45');
    await waitFor(() => expect(save).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/market/lots/5/sales/9/', expect.anything()));
  });

  it('asks for the buyer of a debt sale, then creates the buyer and sends its id', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { id: 4, name: 'Рустам', phone: '' } })
      .mockResolvedValueOnce(saved());
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    await user.click(screen.getByRole('button', { name: 'В долг' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }));
    expect(await screen.findByText('Укажите покупателя.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Кто покупает?'), 'Рустам');
    await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenNthCalledWith(1, '/market/buyers/', { name: 'Рустам' }, expect.anything());
    expect(api.post).toHaveBeenNthCalledWith(2, '/market/lots/5/sales/',
      { unit: 'box', qty: 10, gross_kg: '104.50', price_kg: '45.00', paid_on_spot: false, buyer_id: 4 },
      expect.anything());
  });

  it('closes the truck on the last boxes and still undoes from the toast', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(saved('2026-10-08T12:00:00Z'));
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { lot: lotFixture() } });
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }));
    expect(await screen.findByText(/Машина закрыта\.$/, { selector: '.mk-toast span' })).toBeInTheDocument();
    expect(screen.getByText('Машина закрыта. Ящиков не осталось.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить продажу' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/market/lots/5/sales/9/', expect.anything()));
  });

  it('caps the stepper at what is left', async () => {
    const user = userEvent.setup();
    renderLot();
    const qty = await screen.findByLabelText('Сколько ящиков?');
    await user.clear(qty);
    await user.type(qty, '99');
    expect(qty).toHaveValue('68');
    expect(screen.getByText('В машине осталось только 68 ящиков')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Паллета' }));
    expect(screen.getByLabelText('Сколько паллет?')).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'На один больше' }));
    expect(screen.getByLabelText('Сколько паллет?')).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Вся машина' }));
    expect(screen.getByText('Всё, что осталось: 68 ящиков')).toBeInTheDocument();
  });
});
