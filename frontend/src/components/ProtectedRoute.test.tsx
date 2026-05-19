import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import type { ICurrentUser, UserRole } from '@/types';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

function fakeUser(overrides: Partial<ICurrentUser> = {}): ICurrentUser {
  return {
    id: 1,
    username: 'gadam',
    email: '',
    first_name: '',
    last_name: '',
    role: 'export_manager' as UserRole,
    is_superuser: false,
    managed_block_ids: [],
    permissions: [],
    page_permissions: {},
    resource_permissions: {},
    field_permissions: {},
    ...overrides,
  };
}

function renderWithRoutes(child: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/protected" element={child} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route path="/unauthorized" element={<div>UNAUTHORIZED_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
  });

  it('shows a spinner while auth is loading', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isLoading: true, isError: false });
    const { container } = renderWithRoutes(
      <ProtectedRoute>
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(container.querySelector('.ant-spin')).toBeInTheDocument();
    expect(screen.queryByText('CHILD')).not.toBeInTheDocument();
    expect(screen.queryByText('LOGIN_PAGE')).not.toBeInTheDocument();
  });

  it('redirects to /login when useAuth reports an error', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isLoading: false, isError: true });
    renderWithRoutes(
      <ProtectedRoute>
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument();
    expect(screen.queryByText('CHILD')).not.toBeInTheDocument();
  });

  it('redirects to /login when user is null even without an error flag', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, isLoading: false, isError: false });
    renderWithRoutes(
      <ProtectedRoute>
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument();
  });

  it('renders children when role matches the allowed list', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({ role: 'export_manager' as UserRole }),
      isLoading: false,
      isError: false,
    });
    renderWithRoutes(
      <ProtectedRoute roles={['export_manager' as UserRole, 'document_team' as UserRole]}>
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('CHILD')).toBeInTheDocument();
  });

  it('redirects to /unauthorized when role is not in the allowed list', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({ role: 'warehouse_chief' as UserRole }),
      isLoading: false,
      isError: false,
    });
    renderWithRoutes(
      <ProtectedRoute roles={['export_manager' as UserRole]}>
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('UNAUTHORIZED_PAGE')).toBeInTheDocument();
    expect(screen.queryByText('CHILD')).not.toBeInTheDocument();
  });

  it('lets a superuser through any role gate', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({ role: 'warehouse_chief' as UserRole, is_superuser: true }),
      isLoading: false,
      isError: false,
    });
    renderWithRoutes(
      <ProtectedRoute roles={['export_manager' as UserRole]}>
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('CHILD')).toBeInTheDocument();
  });

  it('with pageCode: redirects when the page is not in page_permissions', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({ page_permissions: { 'export.shipments': true } }),
      isLoading: false,
      isError: false,
    });
    renderWithRoutes(
      <ProtectedRoute pageCode="admin.users">
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('UNAUTHORIZED_PAGE')).toBeInTheDocument();
  });

  it('with pageCode: renders when the page is granted', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({ page_permissions: { 'admin.users': true } }),
      isLoading: false,
      isError: false,
    });
    renderWithRoutes(
      <ProtectedRoute pageCode="admin.users">
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('CHILD')).toBeInTheDocument();
  });

  it('with array pageCode: OR-grants when ANY page is allowed', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({ page_permissions: { 'export.quota': true } }),
      isLoading: false,
      isError: false,
    });
    renderWithRoutes(
      <ProtectedRoute pageCode={['admin.users', 'export.quota']}>
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('CHILD')).toBeInTheDocument();
  });

  it('with array pageCode: redirects when NONE are allowed', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({ page_permissions: { 'export.shipments': true } }),
      isLoading: false,
      isError: false,
    });
    renderWithRoutes(
      <ProtectedRoute pageCode={['admin.users', 'admin.seasons']}>
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('UNAUTHORIZED_PAGE')).toBeInTheDocument();
  });

  it('superuser bypasses pageCode checks too', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({ is_superuser: true, page_permissions: {} }),
      isLoading: false,
      isError: false,
    });
    renderWithRoutes(
      <ProtectedRoute pageCode="admin.users">
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('CHILD')).toBeInTheDocument();
  });

  it('inherits the parent-page rule: granting a child page grants the parent', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({ page_permissions: { 'export.quota.local_sell': true } }),
      isLoading: false,
      isError: false,
    });
    renderWithRoutes(
      <ProtectedRoute pageCode="export.quota">
        <div>CHILD</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText('CHILD')).toBeInTheDocument();
  });
});
