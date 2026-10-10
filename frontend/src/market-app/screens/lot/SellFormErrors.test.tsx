import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import api from '@/services/api';
import { hideToast } from '../../components/toastStore';
import { fillSale, mockSellerApi, renderLot, saved } from './sellTestKit';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe('SellForm errors', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(mockSellerApi);

  afterEach(() => act(() => hideToast()));

  it('shows a server 400 on the weight under the weight field', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { gross_kg: ['Сервер: вес не тот.'] } } });
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }));
    const err = await screen.findByText('Сервер: вес не тот.');
    expect(screen.getByLabelText('Вес с ящиками, кг')).toHaveAttribute('aria-describedby', err.id);
    expect(screen.getByRole('button', { name: 'Сохранить продажу' })).toBeEnabled();
  });

  it('shows friendly text, never the raw code, for a 409 and a 500', async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce({ response: { status: 409, data: { error: 'idempotency_in_progress' } } })
      .mockRejectedValueOnce({ response: { status: 500, data: { error: 'server_error' } } });
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    const save = screen.getByRole('button', { name: 'Сохранить продажу' });
    await user.click(save);
    expect(await screen.findByRole('alert')).toHaveTextContent('Предыдущее сохранение ещё идёт — подождите секунду.');
    await user.click(save);
    expect(await screen.findByText('Проверьте список — продажа могла сохраниться.')).toBeInTheDocument();
    expect(screen.queryByText(/idempotency_in_progress|server_error/)).not.toBeInTheDocument();
  });

  it('after a 500 refetches the lot and retries with the same Idempotency-Key', async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce({ response: { status: 500, data: { error: 'server_error' } } })
      .mockResolvedValueOnce(saved());
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    const lotReads = (): number => vi.mocked(api.get).mock.calls.filter(([url]) => url === '/market/lots/5/').length;
    const before = lotReads();
    const save = screen.getByRole('button', { name: 'Сохранить продажу' });
    await user.click(save);
    expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте список — продажа могла сохраниться.');
    await waitFor(() => expect(lotReads()).toBe(before + 1));
    await user.click(save);
    await screen.findByText(/^Сохранено:/);
    const keys = vi.mocked(api.post).mock.calls.map((c) => c[2]?.headers?.['Idempotency-Key']);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);
  });

  it('says the undo failed in words when the server answers with a code', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(saved());
    vi.mocked(api.delete).mockRejectedValueOnce({ response: { status: 500, data: { error: 'server_error' } } });
    const user = userEvent.setup();
    renderLot();
    await fillSale(user);
    await user.click(screen.getByRole('button', { name: 'Сохранить продажу' }));
    await user.click(await screen.findByRole('button', { name: 'Отменить' }));
    expect(await screen.findByText('Не удалось отменить продажу. Удалите её из списка.')).toBeInTheDocument();
    expect(screen.queryByText('server_error')).not.toBeInTheDocument();
  });
});
