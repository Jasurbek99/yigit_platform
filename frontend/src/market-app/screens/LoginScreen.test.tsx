import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import api from '@/services/api';
import LoginScreen from './LoginScreen';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/services/api', () => ({
  default: { post: vi.fn() },
}));

function renderLogin(url = '/login') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LoginScreen />
    </MemoryRouter>,
  );
}

async function submit(username = 'aidos', password = 's3cret') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Логин'), username);
  await user.type(screen.getByLabelText('Пароль'), password);
  await user.click(screen.getByRole('button', { name: 'Войти' }));
}

describe('LoginScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  beforeEach(() => {
    mockNavigate.mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('posts the credentials and opens the market home for a seller', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { role: 'agent_seller', first_name: 'Айдос' } });
    renderLogin();
    await submit();
    expect(api.post).toHaveBeenCalledWith('/auth/login/', { username: 'aidos', password: 's3cret' });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('returns to the market deep link from ?next=, without the /m prefix', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { role: 'agent' } });
    renderLogin(`/login?next=${encodeURIComponent('/m/team')}`);
    await submit();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/team', { replace: true }));
  });

  it.each(['//evil.com', '/m/login?next=%2Fm%2Fteam', '/shipments'])(
    'ignores an unsafe or foreign next %s',
    async (next) => {
      vi.mocked(api.post).mockResolvedValueOnce({ data: { role: 'agent' } });
      renderLogin(`/login?next=${encodeURIComponent(next)}`);
      await submit();
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }));
    },
  );

  it('sends staff to the main app with a full page load', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, replace });
    try {
      vi.mocked(api.post).mockResolvedValueOnce({ data: { role: 'export_manager' } });
      renderLogin();
      await submit();
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
      expect(mockNavigate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows an error and stays on bad credentials', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 401, data: { error: 'Invalid credentials' } } });
    renderLogin();
    await submit();
    expect(await screen.findByText('Неверный логин или пароль')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
