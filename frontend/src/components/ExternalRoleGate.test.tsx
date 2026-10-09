import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExternalRoleGate } from './ExternalRoleGate';
import { useAuth } from '@/hooks/useAuth';
import type { ICurrentUser, UserRole } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));

function mockRole(role: UserRole | null) {
  vi.mocked(useAuth).mockReturnValue({
    user: role ? ({ id: 1, username: 'u', role } as ICurrentUser) : null,
    isLoading: false,
    isError: false,
  });
}

describe('ExternalRoleGate', () => {
  const replace = vi.fn();

  beforeEach(() => {
    replace.mockReset();
    vi.stubGlobal('location', { ...window.location, replace });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<UserRole>(['agent', 'agent_seller'])(
    'sends %s to /m/ and never renders the internal layout',
    (role) => {
      mockRole(role);
      render(<ExternalRoleGate><div>app-layout</div></ExternalRoleGate>);
      expect(replace).toHaveBeenCalledWith('/m/');
      expect(screen.queryByText('app-layout')).not.toBeInTheDocument();
    },
  );

  it('renders children for an internal role', () => {
    mockRole('export_manager');
    render(<ExternalRoleGate><div>app-layout</div></ExternalRoleGate>);
    expect(screen.getByText('app-layout')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders children while the user is still loading', () => {
    mockRole(null);
    render(<ExternalRoleGate><div>app-layout</div></ExternalRoleGate>);
    expect(screen.getByText('app-layout')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
