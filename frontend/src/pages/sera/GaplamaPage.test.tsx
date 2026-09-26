import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAuth } from '@/hooks/useAuth';
import GaplamaPage from './GaplamaPage';

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('./GaplamaTab', () => ({ default: () => <div data-testid="gaplama-tab" /> }));

describe('GaplamaPage', () => {
  it('renders GaplamaTab when the user has export.plan', () => {
    (useAuth as any).mockReturnValue({
      user: { page_permissions: { 'tir_takip.gaplama': true, 'export.plan': true } },
    });
    render(<GaplamaPage />);
    expect(screen.getByTestId('gaplama-tab')).toBeInTheDocument();
  });

  it('shows the no-access panel without export.plan', () => {
    (useAuth as any).mockReturnValue({
      user: { page_permissions: { 'tir_takip.gaplama': true, 'export.plan': false } },
    });
    render(<GaplamaPage />);
    expect(screen.queryByTestId('gaplama-tab')).not.toBeInTheDocument();
    expect(screen.getByText('tir_takip.tab_no_access')).toBeInTheDocument();
  });
});
