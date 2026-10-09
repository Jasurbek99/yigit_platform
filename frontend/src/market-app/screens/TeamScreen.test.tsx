import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import api from '@/services/api';
import TeamScreen from './TeamScreen';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const bazaars = [
  { id: 1, name: 'Зелёный', city_id: null, is_active: true },
  { id: 2, name: 'Алтын Орда', city_id: null, is_active: true },
];
const sellers = [
  { id: 7, username: 'aidos', first_name: 'Айдос', last_name: '', is_active: true, bazaar: { id: 1, name: 'Зелёный' } },
];

function page(results: unknown[]) {
  return { data: { count: results.length, next: null, previous: null, results } };
}

function renderTeam() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TeamScreen />
    </QueryClientProvider>,
  );
}

describe('TeamScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.get).mockImplementation((url: string) =>
      Promise.resolve(page(url.includes('bazaars') ? bazaars : sellers)),
    );
  });

  it('shows each seller as «Имя, Базар»', async () => {
    renderTeam();
    expect(await screen.findByText('Айдос, Зелёный')).toBeInTheDocument();
    expect(screen.getByText('Алтын Орда')).toBeInTheDocument();
  });

  it('adds a seller with login, password, name and bazaar', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { id: 8 } });
    const user = userEvent.setup();
    renderTeam();
    await screen.findByText('Айдос, Зелёный');
    await user.click(screen.getByRole('button', { name: 'Добавить продавца' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Логин'), 'nurlan');
    await user.type(within(dialog).getByLabelText('Пароль'), 's3cret-pass');
    await user.type(within(dialog).getByLabelText('Имя'), 'Нурлан');
    await user.selectOptions(within(dialog).getByLabelText('Базар'), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/market/team/sellers/', {
        username: 'nurlan',
        password: 's3cret-pass',
        first_name: 'Нурлан',
        bazaar_id: 2,
      });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('disables a seller', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ data: {} });
    const user = userEvent.setup();
    renderTeam();
    await screen.findByText('Айдос, Зелёный');
    await user.click(screen.getByRole('button', { name: 'Отключить' }));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/market/team/sellers/7/', { is_active: false });
    });
  });

  it('shows a server error under the login field', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { status: 400, data: { username: ['Такой логин уже занят.'] } },
    });
    const user = userEvent.setup();
    renderTeam();
    await screen.findByText('Айдос, Зелёный');
    await user.click(screen.getByRole('button', { name: 'Добавить продавца' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Логин'), 'aidos');
    await user.type(within(dialog).getByLabelText('Пароль'), 's3cret-pass');
    await user.type(within(dialog).getByLabelText('Имя'), 'Айдос');
    await user.selectOptions(within(dialog).getByLabelText('Базар'), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(await within(dialog).findByText('Такой логин уже занят.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Логин')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
