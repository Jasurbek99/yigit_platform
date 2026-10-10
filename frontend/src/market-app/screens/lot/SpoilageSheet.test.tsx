import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import api from '@/services/api';
import { hideToast } from '../../components/toastStore';
import { lotFixture, spoilageFixture } from '../../testFixtures';
import { mockSellerApi, renderLot } from './sellTestKit';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

async function openSheet(user: ReturnType<typeof userEvent.setup>): Promise<ReturnType<typeof within>> {
  await user.click(await screen.findByRole('button', { name: 'Испорчено' }));
  return within(screen.getByRole('dialog'));
}

describe('SpoilageSheet', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(mockSellerApi);

  afterEach(() => act(() => hideToast()));

  it('writes boxes and weight off once, then undoes it from the toast', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { entry: spoilageFixture({ id: 4 }), lot: lotFixture() } });
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { lot: lotFixture() } });
    const user = userEvent.setup();
    renderLot();
    const sheet = await openSheet(user);
    expect(sheet.getByLabelText('Сколько ящиков испортилось?')).toHaveValue('0');
    expect(sheet.getByText('Только вес. Ящики остаются в машине.')).toBeInTheDocument();
    expect(sheet.getByText('Вес можно не писать.')).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Списать' })).toBeDisabled();

    for (let i = 0; i < 3; i += 1) await user.click(sheet.getByRole('button', { name: 'На один больше' }));
    await user.type(sheet.getByLabelText('Вес с ящиками, кг'), '31,35');
    expect(sheet.getByText('Чистый вес: 30 кг (минус 3 ящика по 450 г)')).toBeInTheDocument();

    const save = sheet.getByRole('button', { name: 'Списать' });
    act(() => { save.click(); save.click(); }); // same tick: one create only
    expect(await screen.findByText('Списано: 3 ящика, 30 кг')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/market/lots/5/spoilage/', { boxes: 3, gross_kg: '31.35' }, expect.anything());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/market/lots/5/spoilage/4/', expect.anything()));
  });

  it('sends an empty weight as null and caps the boxes at what is left', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { entry: spoilageFixture({ id: 5, boxes: 68, gross_kg: null, net_kg: '0.00' }), lot: lotFixture() },
    });
    const user = userEvent.setup();
    renderLot();
    const sheet = await openSheet(user);
    const qty = sheet.getByLabelText('Сколько ящиков испортилось?');
    await user.clear(qty);
    await user.type(qty, '99');
    expect(qty).toHaveValue('68');
    expect(sheet.getByText('В машине осталось только 68 ящиков')).toBeInTheDocument();
    await user.click(sheet.getByRole('button', { name: 'Списать' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/market/lots/5/spoilage/', { boxes: 68, gross_kg: null }, expect.anything()));
    expect(await screen.findByText('Списано: 68 ящиков')).toBeInTheDocument();
  });

  it('keeps the sheet open with the server reason when it refuses', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { status: 400, data: { detail: 'Машина ещё в пути — продавать можно после таможни назначения.' } },
    });
    const user = userEvent.setup();
    renderLot();
    const sheet = await openSheet(user);
    await user.click(sheet.getByRole('button', { name: 'На один больше' }));
    await user.click(sheet.getByRole('button', { name: 'Списать' }));
    expect(await sheet.findByRole('alert')).toHaveTextContent('Машина ещё в пути');
    expect(sheet.getByRole('button', { name: 'Списать' })).toBeEnabled();
  });
});
