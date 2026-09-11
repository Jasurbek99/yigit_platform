import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { ContractCreate } from './ContractCreate';

const { mockMutateAsync } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn((_payload: Record<string, unknown>) => Promise.resolve({})),
}));
vi.mock('@/hooks/useContracts', () => ({
  useCreateContract: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

// The three firm/customer pickers each fetch; stub them down to a plain input so
// this file tests the form's own branching, not their loading states.
vi.mock('@/components/ExportFirmSelect', () => ({
  ExportFirmSelect: () => <input aria-label="export firm stub" />,
}));
vi.mock('@/components/ImportFirmSelect', () => ({
  ImportFirmSelect: () => <input aria-label="import firm stub" />,
}));
vi.mock('@/components/CustomerSelect', () => ({
  CustomerSelect: () => <input aria-label="customer stub" />,
}));

const onClose = vi.fn();
const field = (name: string) => document.getElementById(name) as HTMLInputElement | null;

// Matches the ENGLISH option labels by construction — beforeAll pins the
// language. If the English wording changes, update the regexes here; a failure
// looks like a component bug otherwise.
async function chooseType(label: RegExp) {
  await userEvent.click(field('contract_type') as HTMLInputElement);
  await userEvent.click(await screen.findByTitle(label));
}

/**
 * The type is the first question because it decides which of the rest apply.
 * Asking a one-time contract how many trucks it plans, and for a validity
 * window, is the framework question — that is what made this form confusing.
 */
describe('ContractCreate — type-driven fields', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mockMutateAsync.mockClear();
    onClose.mockClear();
    render(<ContractCreate open onClose={onClose} />);
  });

  it('opens on Framework, showing the truck count and the validity window', () => {
    expect(field('planned_trucks')).not.toBeNull();
    expect(field('end_date')).not.toBeNull();
  });

  it('drops both of them once One-time is chosen', async () => {
    await chooseType(/one-time/i);

    await waitFor(() => expect(field('planned_trucks')).toBeNull());
    expect(field('end_date')).toBeNull();
  });

  it('calls the weight a share of the truck, not a season plan', async () => {
    await chooseType(/one-time/i);

    expect(await screen.findByText(/share of the truck/i)).toBeInTheDocument();
  });

  it('does not turn a firm share into a truck count', async () => {
    await chooseType(/one-time/i);
    await userEvent.type(field('planned_quantity_kg') as HTMLInputElement, '9000');
    await userEvent.type(field('price_per_kg') as HTMLInputElement, '0.9');

    // 9 000 kg is one firm's share, not half a truckload to be rounded up.
    await waitFor(() =>
      expect(field('planned_amount_usd')).toHaveValue('8100.00'),
    );
  });

  it('still converts trucks to kilograms for a framework contract', async () => {
    await userEvent.type(field('planned_trucks') as HTMLInputElement, '2');

    await waitFor(() => expect(field('planned_quantity_kg')).toHaveValue('36200'));
  });

  it('goes back to the framework fields when the type is switched back', async () => {
    await chooseType(/one-time/i);
    await waitFor(() => expect(field('planned_trucks')).toBeNull());

    await chooseType(/framework/i);

    await waitFor(() => expect(field('planned_trucks')).not.toBeNull());
    expect(field('end_date')).not.toBeNull();
  });

  it('clears the plan on a type switch rather than carrying a truckload over', async () => {
    // 2 trucks fills 36 200 kg. Keeping that when the field relabels to "this
    // export firm's share of the truck" is a wrong number under a correct label,
    // saved silently onto a document that goes to a bank.
    await userEvent.type(field('planned_trucks') as HTMLInputElement, '2');
    await waitFor(() => expect(field('planned_quantity_kg')).toHaveValue('36200'));

    await chooseType(/one-time/i);

    await waitFor(() => expect(field('planned_quantity_kg')).toHaveValue(''));
    expect(field('planned_amount_usd')).toHaveValue('');
  });
});
