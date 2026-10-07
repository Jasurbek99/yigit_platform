import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import i18n from '@/i18n';
import OptionListsTab from './OptionListsTab';
import api from '@/services/api';
import type { IProductType, ITomatoVariety } from '@/types';

// Same mocking style as OptionListsTab.carryDays.test.tsx: mock the HTTP layer
// so the real hooks build the payload and the test sees the wire body.
vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const TOMATO: IProductType = {
  id: 1, name: 'Pomidor', code: 'tomato', hs_code: '070200000',
  name_en: 'Tomato', name_ru: 'Томат', name_tk: 'Pomidor',
};
const PEPPER: IProductType = {
  id: 2, name: 'Bolgar burç', code: 'pepper', hs_code: '0709601000',
  name_en: 'Pepper', name_ru: 'Перец', name_tk: 'Burç',
};

function variety(overrides: Partial<ITomatoVariety> = {}): ITomatoVariety {
  return {
    id: 7,
    name: 'Kapya',
    type: null,
    avg_fruit_weight_gr: null,
    code: 'KAP',
    is_experimental: false,
    scientific_name: '',
    product_type: PEPPER.id,
    product_type_code: 'pepper',
    ...overrides,
  };
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.startsWith('/core/product-types/')) return Promise.resolve({ data: [TOMATO, PEPPER] });
    if (url.startsWith('/core/tomato-varieties/')) return Promise.resolve({ data: [variety()] });
    return Promise.resolve({ data: [] });
  });
});

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // virtual={false}: see OptionListsTab.carryDays.test.tsx (jsdom has no layout
  // engine, so virtualised Select options never render).
  return render(
    <ConfigProvider locale={enUS} virtual={false}>
      <QueryClientProvider client={queryClient}>
        <OptionListsTab canWrite />
      </QueryClientProvider>
    </ConfigProvider>,
  );
}

async function selectCategory(name: string) {
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(await screen.findByText(name));
}

describe('OptionListsTab — products list', () => {
  it('lists the products with code and raw HS code', async () => {
    renderTab();
    await selectCategory('Products');

    const tomatoRow = (await screen.findByText('Pomidor', { selector: 'strong' })).closest('tr');
    const pepperRow = (await screen.findByText('Bolgar burç')).closest('tr');
    if (!tomatoRow || !pepperRow) throw new Error('product rows not found');

    expect(within(tomatoRow).getByText('070200000')).toBeInTheDocument();
    expect(within(tomatoRow).getByText('tomato')).toBeInTheDocument();
    expect(within(pepperRow).getByText('0709601000')).toBeInTheDocument();
    expect(within(pepperRow).getByText('pepper')).toBeInTheDocument();
  });

  it('PATCHes the pepper product when its HS code is edited', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: PEPPER });

    renderTab();
    await selectCategory('Products');

    const row = (await screen.findByText('Bolgar burç')).closest('tr');
    if (!row) throw new Error('pepper row not found');
    await userEvent.click(within(row).getByRole('button', { name: 'edit' }));

    const hsInput = await screen.findByLabelText('HS code', { selector: 'input' });
    expect(hsInput).toHaveValue('0709601000');
    await userEvent.clear(hsInput);
    await userEvent.type(hsInput, '0709609000');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.patch).mock.calls[0];
    expect(url).toBe('/core/product-types/2/');
    expect(body).toMatchObject({ name: 'Bolgar burç', code: 'pepper', hs_code: '0709609000' });
  });

  it('locks the code when editing a product, leaves it open when adding one', async () => {
    renderTab();
    await selectCategory('Products');

    const row = (await screen.findByText('Bolgar burç')).closest('tr');
    if (!row) throw new Error('pepper row not found');
    await userEvent.click(within(row).getByRole('button', { name: 'edit' }));
    expect(await screen.findByLabelText('Code', { selector: 'input' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: /Add/i }));
    await waitFor(() => expect(screen.getByLabelText('Code', { selector: 'input' })).toBeEnabled());
  });

  it('POSTs a new product to the product-types endpoint', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: PEPPER });

    renderTab();
    await selectCategory('Products');
    await userEvent.click(screen.getByRole('button', { name: /Add/i }));

    await userEvent.type(await screen.findByLabelText('Name', { selector: 'input' }), 'Hyyar');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/core/product-types/');
    expect(body).toMatchObject({ name: 'Hyyar' });
  });
});

describe('OptionListsTab — variety product', () => {
  it('shows each variety\'s product in the table', async () => {
    renderTab();
    await selectCategory('Variety');

    const row = (await screen.findByText('Kapya')).closest('tr');
    if (!row) throw new Error('variety row not found');
    expect(within(row).getByText('Pepper')).toBeInTheDocument();
  });

  it('sends the chosen product when editing a variety', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: variety() });

    renderTab();
    await selectCategory('Variety');

    const row = (await screen.findByText('Kapya')).closest('tr');
    if (!row) throw new Error('variety row not found');
    await userEvent.click(within(row).getByRole('button', { name: 'edit' }));

    // Product select is pre-filled with the variety's current product.
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTitle('Bolgar burç');

    await userEvent.click(within(dialog).getByLabelText('Product'));
    await userEvent.click(await screen.findByTitle('Pomidor'));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.patch).mock.calls[0];
    expect(url).toBe('/core/tomato-varieties/7/');
    expect(body).toMatchObject({ product_type: TOMATO.id });
  });
});
