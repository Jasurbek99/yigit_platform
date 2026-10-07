import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import ContractList from './ContractList';

const rows = [
  { id: 1, contract_number: 'F-1', contract_type: 'FRAMEWORK', status: 'active', product_type_code: 'tomato' },
  { id: 2, contract_number: 'O-1', contract_type: 'ONE_TIME', status: 'active', product_type_code: 'pepper' },
];

vi.mock('@/hooks/useContracts', () => ({
  useContracts: () => ({ data: { results: rows }, isLoading: false, isError: false }),
  useDeleteContract: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('./ContractCreate', () => ({ ContractCreate: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('ContractList — product column', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the product of a one-time contract on the One-time tab', async () => {
    render(
      <MemoryRouter>
        <ContractList />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('tab', { name: /one-time/i }));

    await waitFor(() => expect(screen.getByText('O-1')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'Product' })).toBeInTheDocument();
    expect(screen.getByText('Pepper')).toBeInTheDocument();
  });
});
