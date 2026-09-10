import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import type { IShipmentFirmContracts } from '@/types/contract';
import { ShipmentFirmContractsPanel } from './ShipmentFirmContractsPanel';

let mockData: IShipmentFirmContracts;
const { mockMutate } = vi.hoisted(() => ({ mockMutate: vi.fn() }));
vi.mock('@/hooks/useShipmentFirmContracts', () => ({
  useShipmentFirmContracts: () => ({ data: mockData, isLoading: false }),
  useLinkFirmContract: () => ({ mutate: mockMutate, isPending: false }),
}));

interface IMockUser {
  is_superuser: boolean;
  role: string;
  resource_permissions: Record<string, { view: boolean }>;
  page_permissions: Record<string, boolean>;
}
let mockUser: IMockUser | null = null;
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, isError: false }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

function payload(overrides: Partial<IShipmentFirmContracts> = {}): IShipmentFirmContracts {
  return {
    shipment: 1,
    import_firm: 5,
    import_firm_name: 'Import KZ',
    contract_template_supported: true,
    import_firm_director: 'Иванов И.И.',
    rows: [
      {
        export_firm: 2,
        export_firm_code: 'YGT',
        export_firm_name: 'Yigit H.J.',
        weight_kg: '9000.00',
        amount_usd: '12000.00',
        money_warning: 'bank',
        framework_options: [],
        linked: { contract_id: 42, contract_number: '177/25-YGT-EXP', contract_type: 'FRAMEWORK' },
      },
    ],
    ...overrides,
  };
}

// Non-superuser on purpose: superuser short-circuits both gates, which is exactly
// what the divergence tests below need to bypass.
const FULL_ACCESS: IMockUser = {
  is_superuser: false,
  role: 'document_team',
  resource_permissions: { contract: { view: true } },
  page_permissions: { 'contracts.list': true },
};

function wrap() {
  return render(
    <MemoryRouter>
      <ShipmentFirmContractsPanel shipmentId={1} />
    </MemoryRouter>,
  );
}

describe('ShipmentFirmContractsPanel — linked contract', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mockData = payload();
    mockUser = FULL_ACCESS;
  });

  it('links the contract number through to its page', () => {
    wrap();

    expect(screen.getByRole('link', { name: '177/25-YGT-EXP' })).toHaveAttribute(
      'href',
      '/contracts/42',
    );
  });

  it('offers the generator for a template-supported destination', () => {
    wrap();

    expect(screen.getByRole('button', { name: /download contract/i })).toBeEnabled();
  });

  it('disables the generator when the destination country has no template', () => {
    mockData = payload({ contract_template_supported: false });
    wrap();

    expect(screen.getByRole('button', { name: /download contract/i })).toBeDisabled();
  });

  it('shows the plain number, no link and no generator, with neither grant', () => {
    mockUser = { is_superuser: false, role: 'logist', resource_permissions: {}, page_permissions: {} };
    wrap();

    expect(screen.getByText('177/25-YGT-EXP')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download contract/i })).not.toBeInTheDocument();
  });

  // The two affordances go through two independently-toggleable guards: the link
  // lands on a route gated by the `contracts.list` PAGE code, the generator hits an
  // endpoint gated by the `contract` RESOURCE. Gating both on one would either hide
  // a working button or hand someone a link straight to Unauthorized.
  it('drops the link but keeps the generator when only the page code is missing', () => {
    mockUser = { ...FULL_ACCESS, page_permissions: {} };
    wrap();

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('177/25-YGT-EXP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download contract/i })).toBeInTheDocument();
  });

  it('drops the generator but keeps the link when only the resource is missing', () => {
    mockUser = { ...FULL_ACCESS, resource_permissions: {} };
    wrap();

    expect(screen.getByRole('link', { name: '177/25-YGT-EXP' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download contract/i })).not.toBeInTheDocument();
  });

  it('leaves an unlinked split on its link / create-one-time controls', () => {
    mockData = payload({
      rows: [{ ...payload().rows[0], linked: null, framework_options: [{ id: 9, contract_number: '12/25' }] }],
    });
    wrap();

    expect(screen.getByRole('button', { name: /^link$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create one-time/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download contract/i })).not.toBeInTheDocument();
  });
});

/**
 * A one-time contract inherits no terms from a framework agreement, so its
 * document has nothing to print in the price, quantity and total placeholders
 * unless the operator supplies the price here. The panel therefore refuses to
 * create one without it.
 */
describe('ShipmentFirmContractsPanel — one-time price', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mockMutate.mockClear();
    mockUser = FULL_ACCESS;
    mockData = payload({
      rows: [{ ...payload().rows[0], linked: null, framework_options: [] }],
    });
  });

  const createButton = () => screen.getByRole('button', { name: /create one-time/i });
  const priceInput = () => screen.getByRole('spinbutton');

  it('pre-fills the price from the split amount over its weight', () => {
    wrap();

    // 12000 / 9000 = 1.3333
    expect(priceInput()).toHaveValue('1.3333');
  });

  it('sends the price with the one-time request', async () => {
    wrap();
    await userEvent.click(createButton());

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'one_time', price_per_kg: 1.3333 }),
      expect.anything(),
    );
  });

  it('sends the operator’s own price when they overwrite the suggestion', async () => {
    wrap();
    await userEvent.clear(priceInput());
    await userEvent.type(priceInput(), '0.85');
    await userEvent.click(createButton());

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'one_time', price_per_kg: 0.85 }),
      expect.anything(),
    );
  });

  it('blocks creation while the price is empty', async () => {
    mockData = payload({
      rows: [{
        ...payload().rows[0], linked: null, framework_options: [],
        amount_usd: null, weight_kg: null,
      }],
    });
    wrap();

    expect(priceInput()).toHaveValue('');
    expect(createButton()).toBeDisabled();

    await userEvent.click(createButton());
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('leaves the framework link alone — it needs no price', async () => {
    mockData = payload({
      rows: [{
        ...payload().rows[0], linked: null,
        framework_options: [{ id: 9, contract_number: '12/25' }],
      }],
    });
    wrap();
    await userEvent.click(screen.getByRole('button', { name: /^link$/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'framework', contract_id: 9 }),
      expect.anything(),
    );
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('price_per_kg');
  });
});
