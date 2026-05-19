import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import LoginPage from './LoginPage';
import api from '@/services/api';

// react-router-dom is partially mocked: keep MemoryRouter and the rest of the
// public surface real, but swap useNavigate for a vi.fn so the test can assert
// the post-login redirect target without rendering a full Routes tree.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/services/api', () => ({
  default: { post: vi.fn() },
}));

function renderLogin() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeAll(async () => {
    // Pin language to English so assertions are stable regardless of what
    // the language-detector picks up from happy-dom's navigator/cookie state.
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mockNavigate.mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('renders title, both inputs, and the submit button', () => {
    renderLogin();
    expect(screen.getByText('YGT Platform')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('shows validation errors and skips the API call when the form is empty', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(
      await screen.findByText('Please enter your username'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Please enter your password'),
    ).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('posts credentials and navigates to / for non-boss roles', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        id: 1,
        username: 'gadam',
        role: 'export_manager',
        first_name: 'Gadam',
        last_name: '',
        email: '',
        is_superuser: false,
        managed_block_ids: [],
        permissions: [],
        page_permissions: {},
        resource_permissions: {},
        field_permissions: {},
      },
    });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText('Username'), 'gadam');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/login/', {
        username: 'gadam',
        password: 'secret',
      });
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('navigates to /boss/dashboard when the boss role logs in', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        id: 2,
        username: 'boss',
        role: 'boss',
        first_name: 'Boss',
        last_name: '',
        email: '',
        is_superuser: false,
        managed_block_ids: [],
        permissions: [],
        page_permissions: {},
        resource_permissions: {},
        field_permissions: {},
      },
    });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText('Username'), 'boss');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/boss/dashboard');
    });
  });

  it('does not navigate when the API rejects', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { status: 401, data: { error: 'bad creds' } },
    });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText('Username'), 'wrong');
    await user.type(screen.getByPlaceholderText('Password'), 'bad');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalled();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
