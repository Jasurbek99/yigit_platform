import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import api from '@/services/api';
import TeamScreen from '../TeamScreen';
import { page } from '../../testFixtures';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const bazaars = [
  { id: 1, name: 'Зелёный', city_id: null, is_active: true },
  { id: 2, name: 'Алтын Орда', city_id: null, is_active: true },
  { id: 3, name: 'Старый', city_id: null, is_active: false },
];
const sellers = [
  { id: 7, username: 'aidos', first_name: 'Айдос', last_name: '', is_active: true, bazaar: { id: 1, name: 'Зелёный' } },
];

function renderTeam(): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><TeamScreen /></QueryClientProvider>);
}

describe('team edits', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(() => {
    [api.get, api.post, api.patch].forEach((fn) => vi.mocked(fn).mockReset());
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve(url.includes('bazaars') ? page(bazaars) : page(sellers)));
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
  });

  it('renames a bazaar', async () => {
    const user = userEvent.setup();
    renderTeam();
    await screen.findByText('Айдос, Зелёный');
    await user.click(screen.getAllByRole('button', { name: 'Изменить' })[0]);
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText('Название базара');
    expect(name).toHaveValue('Зелёный');
    await user.clear(name);
    await user.type(name, 'Зелёный рынок');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/market/team/bazaars/1/', { name: 'Зелёный рынок', is_active: true });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('turns a bazaar off and back on', async () => {
    const user = userEvent.setup();
    renderTeam();
    await screen.findByText('Айдос, Зелёный');
    await user.click(screen.getAllByRole('button', { name: 'Изменить' })[1]);
    await user.click(within(screen.getByRole('dialog')).getByLabelText('Базар работает'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/market/team/bazaars/2/', { name: 'Алтын Орда', is_active: false });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: 'Изменить' })[2]);
    const box = within(screen.getByRole('dialog')).getByLabelText('Базар работает');
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/market/team/bazaars/3/', { name: 'Старый', is_active: true });
    });
  });

  it('shows the server error under the bazaar name', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce({
      response: { status: 400, data: { name: ['Базар с таким названием уже есть.'] } },
    });
    const user = userEvent.setup();
    renderTeam();
    await screen.findByText('Айдос, Зелёный');
    await user.click(screen.getAllByRole('button', { name: 'Изменить' })[0]);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await within(dialog).findByText('Базар с таким названием уже есть.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('moves a seller to another active bazaar', async () => {
    const user = userEvent.setup();
    renderTeam();
    await screen.findByText('Айдос, Зелёный');
    await user.click(screen.getByRole('button', { name: 'Сменить базар' }));
    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByLabelText('Базар');
    expect(select).toHaveValue('1');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Зелёный', 'Алтын Орда']);
    await user.selectOptions(select, '2');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/market/team/sellers/7/', { bazaar_id: 2 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
