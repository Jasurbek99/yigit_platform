import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import AgentLoginsPage from './AgentLoginsPage';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AGENTS = [
  { id: 1, username: 'agent_aman', first_name: 'Aman', last_name: 'Berdiyev', is_active: true, customer: { id: 10, name: 'Almaty Fruit' } },
  { id: 2, username: 'agent_olga', first_name: 'Ольга', last_name: '', is_active: false, customer: { id: 11, name: 'Москва Опт' } },
];
const CUSTOMERS = [
  { id: 10, name: 'Almaty Fruit' },
  { id: 11, name: 'Москва Опт' },
];

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith('/market/agents/')) {
      return { data: { count: 2, next: null, previous: null, results: AGENTS } } as never;
    }
    return { data: { results: CUSTOMERS } } as never;
  });
  vi.mocked(useAuth).mockReturnValue({ user: { id: 1, role: 'admin', is_superuser: true } } as never);
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgentLoginsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentLoginsPage', () => {
  it('lists agent logins with their customers', async () => {
    renderPage();

    expect(await screen.findByText('agent_aman')).toBeInTheDocument();
    expect(screen.getByText('agent_olga')).toBeInTheDocument();
    expect(screen.getByText('Almaty Fruit')).toBeInTheDocument();
    expect(screen.getByText('Москва Опт')).toBeInTheDocument();
  });

  it('creates a login for the chosen customer', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { ...AGENTS[0], id: 3 } } as never);
    renderPage();
    await screen.findByText('agent_aman');

    fireEvent.click(screen.getByRole('button', { name: /Добавить логин/ }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.mouseDown(within(dialog).getByRole('combobox'));
    fireEvent.click(await screen.findByTitle('Москва Опт'));
    fireEvent.change(within(dialog).getByLabelText('Логин'), { target: { value: 'new_agent' } });
    fireEvent.change(within(dialog).getByLabelText('Пароль'), { target: { value: 'S3cret-pass' } });
    fireEvent.change(within(dialog).getByLabelText('Имя'), { target: { value: 'Нурлан' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Создать/ }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/market/agents/', {
        customer_id: 11,
        username: 'new_agent',
        password: 'S3cret-pass',
        first_name: 'Нурлан',
      }),
    );
  });

  it('shows the server field error under the field', async () => {
    vi.mocked(api.post).mockRejectedValue({
      response: { status: 400, data: { username: ['Этот логин уже занят'] } },
    });
    renderPage();
    await screen.findByText('agent_aman');

    fireEvent.click(screen.getByRole('button', { name: /Добавить логин/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(within(dialog).getByRole('combobox'));
    fireEvent.click(await screen.findByTitle('Almaty Fruit'));
    fireEvent.change(within(dialog).getByLabelText('Логин'), { target: { value: 'agent_aman' } });
    fireEvent.change(within(dialog).getByLabelText('Пароль'), { target: { value: 'S3cret-pass' } });
    fireEvent.change(within(dialog).getByLabelText('Имя'), { target: { value: 'Aman' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Создать/ }));

    expect(await screen.findByText('Этот логин уже занят')).toBeInTheDocument();
  });

  it('hides the add button from a read-only user', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 2,
        role: 'director',
        is_superuser: false,
        resource_permissions: { market_agent: { view: true, create: false, edit: false, delete: false } },
      },
    } as never);
    renderPage();

    expect(await screen.findByText('agent_aman')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Добавить логин/ })).not.toBeInTheDocument();
  });

  it('patches is_active when the switch is toggled', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { ...AGENTS[0], is_active: false } } as never);
    renderPage();
    await screen.findByText('agent_aman');

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/market/agents/1/', { is_active: false }));
  });

  it('the change-password dialog explains the 8-hour login', async () => {
    renderPage();
    await screen.findByText('agent_aman');
    fireEvent.click(screen.getAllByRole('button', { name: /Сменить пароль/ })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/до 8 часов/)).toBeInTheDocument();
  });
});
