import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { ContractPlanEdit } from './ContractPlanEdit';
import type { IContractDetail } from '@/types/contract';

const { mockMutateAsync } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn((_payload: Record<string, unknown>) => Promise.resolve({})),
}));
vi.mock('@/hooks/useContracts', () => ({
  useUpdateContractPlan: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

function contract(overrides: Partial<IContractDetail> = {}): IContractDetail {
  return {
    id: 7,
    contract_number: '500/25-YGT-EXP',
    contract_type: 'ONE_TIME',
    planned_trucks: null,
    planned_quantity_kg: null,
    price_per_kg: null,
    planned_amount_usd: null,
    ...overrides,
  } as unknown as IContractDetail;
}

const onClose = vi.fn();

function wrap(c: IContractDetail = contract()) {
  return render(<ContractPlanEdit open contract={c} onClose={onClose} />);
}

/** By id, not label: three of the four labels share the words "planned" and
 *  "quantity"/"amount", so a label regex matches more than one input. */
const field = (name: string): HTMLInputElement => {
  const el = document.getElementById(name);
  if (!el) throw new Error(`no field ${name}`);
  return el as HTMLInputElement;
};

// The default fixture is ONE_TIME, so the truck count is hidden in most tests
// here; the framework case passes contract_type explicitly.

/**
 * The one place a contract's price can be corrected after it exists. Every
 * contract auto-created from the Sheet before 2026-09-10 has a NULL price,
 * quantity and total, and its generated .docx prints all three blank.
 */
describe('ContractPlanEdit', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mockMutateAsync.mockClear();
    onClose.mockClear();
  });

  it('seeds the form from the contract', () => {
    wrap(contract({
      contract_type: 'FRAMEWORK',
      planned_trucks: 2,
      planned_quantity_kg: '18000.00',
      price_per_kg: '0.9000',
      planned_amount_usd: '16200.00',
    } as Partial<IContractDetail>));

    expect(field('price_per_kg')).toHaveValue('0.9000');
    expect(field('planned_quantity_kg')).toHaveValue('18000.00');
    // trucks matters beyond display: deriveContractPlan reads it when the price
    // is edited on a framework contract that already has one.
    expect(field('planned_trucks')).toHaveValue('2');
  });

  it('hides the truck count on a one-time contract', () => {
    // Same rule as the create form: a one-time contract is one export firm's
    // share of one truck, so a truck count is the framework question. Showing it
    // here would contradict the form the contract was created in.
    wrap(contract({ contract_type: 'ONE_TIME' } as Partial<IContractDetail>));

    expect(document.getElementById('planned_trucks')).toBeNull();
    expect(field('planned_quantity_kg')).not.toBeNull();
  });

  it('derives the total when the price is typed', async () => {
    wrap(contract({ planned_quantity_kg: '9000.00' } as Partial<IContractDetail>));

    await userEvent.type(field('price_per_kg'), '0.9');

    await waitFor(() => expect(field('planned_amount_usd')).toHaveValue('8100.00'));
  });

  it('sends the four planned fields and nothing else', async () => {
    wrap(contract({ planned_quantity_kg: '9000.00' } as Partial<IContractDetail>));
    await userEvent.type(field('price_per_kg'), '0.9');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(Object.keys(mockMutateAsync.mock.calls[0][0]).sort()).toEqual([
      'planned_amount_usd', 'planned_quantity_kg', 'planned_trucks', 'price_per_kg',
    ]);
  });

  it('sends null, not undefined, for a field left empty', async () => {
    wrap();
    await userEvent.type(field('price_per_kg'), '1.25');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    const payload = mockMutateAsync.mock.calls[0][0];
    expect(payload.price_per_kg).toBe(1.25);
    expect(payload.planned_quantity_kg).toBeNull();
  });

  it('says the invoice price lives elsewhere', () => {
    wrap();

    expect(screen.getByText(/invoice prints the sale/i)).toBeInTheDocument();
  });
});
