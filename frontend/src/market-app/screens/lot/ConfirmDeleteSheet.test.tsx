import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import api from '@/services/api';
import { hideToast } from '../../components/toastStore';
import { lotDetailFixture, lotFixture } from '../../testFixtures';
import { mockLotApi, renderLot } from './sellTestKit';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe('deleting a lot entry', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  afterEach(() => act(() => hideToast()));

  it('lets the agent delete any row after confirming', async () => {
    mockLotApi('agent');
    vi.mocked(api.delete).mockResolvedValueOnce({ data: { lot: lotFixture() } });
    const user = userEvent.setup();
    renderLot();
    // Newest first: the expense (8 Oct 15:00), sale 1 (8 Oct 14:35), sale 2 (7 Oct).
    const rows = await screen.findAllByRole('button', { name: 'Удалить' });
    expect(rows).toHaveLength(3);

    await user.click(rows[0]);
    let sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByRole('heading')).toHaveTextContent('Удалить эту запись?');
    expect(sheet.getByText(/^Расход: Комиссия, 1\s000\s₸$/)).toBeInTheDocument();
    await user.click(sheet.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(rows[1]);
    sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByRole('heading')).toHaveTextContent('Удалить эту продажу?');
    expect(sheet.getByText(/^12 ящиков, 80,5 кг, 3\s622,5\s₸$/)).toBeInTheDocument();
    await user.click(sheet.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/market/lots/5/sales/1/', expect.anything()));
    expect(api.delete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Удалить' })).toHaveLength(2));
  });

  it('shows no delete to a seller on rows someone else wrote', async () => {
    mockLotApi('agent_seller'); // every fixture row was written by user 3; the lot's seller is 7
    renderLot();
    expect(await screen.findByText('Продажи с этой машины')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
  });

  it('shows the seller delete on his own rows only', async () => {
    const detail = lotDetailFixture();
    mockLotApi('agent_seller', { ...detail, sales: [{ ...detail.sales[0], created_by: 7 }, detail.sales[1]] });
    renderLot();
    expect(await screen.findAllByRole('button', { name: 'Удалить' })).toHaveLength(1);
  });

  it('puts a refused delete into a toast', async () => {
    mockLotApi('agent');
    vi.mocked(api.delete).mockRejectedValueOnce({
      response: { status: 400, data: { detail: 'Отчёт по машине утверждён — изменить продажи нельзя.' } },
    });
    const user = userEvent.setup();
    renderLot();
    await user.click((await screen.findAllByRole('button', { name: 'Удалить' }))[1]);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Отчёт по машине утверждён — изменить продажи нельзя.')).toBeInTheDocument();
  });
});
