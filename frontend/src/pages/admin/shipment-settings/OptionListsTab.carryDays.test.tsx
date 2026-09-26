import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import i18n from '@/i18n';
import OptionListsTab from './OptionListsTab';
import api from '@/services/api';
import type { IGreenhouseBlock } from '@/types';

// Same reasoning as ProcessNodeLinksPage.test.tsx: mock the HTTP layer, not
// the hooks, so the real useCreateBlock/useUpdateBlock build the payload —
// this is what lets the test see the exact body sent over the wire, the
// same thing a hand traced review of the runtime payload would see.
vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

function block(overrides: Partial<IGreenhouseBlock> = {}): IGreenhouseBlock {
  return {
    id: 9,
    code: 'Q',
    name: 'Old Name',
    parent: null,
    parent_code: null,
    manager: null,
    manager_name: null,
    variety_main: null,
    variety_main_name: null,
    variety_secondary: null,
    variety_secondary_name: null,
    area_m2: null,
    location: null,
    location_name: null,
    section_count: null,
    sowing_date: null,
    season_start_month: null,
    is_active: true,
    sub_blocks: [],
    carry_days: 25,
    ...overrides,
  };
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
});

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // locale mirrors App.tsx — without it, the Modal footer's OK/Cancel buttons
  // render in whatever locale a sibling import last installed globally,
  // which makes name-based button queries flaky. virtual={false} is antd's
  // documented escape hatch for its Select dropdown virtualization (rc-
  // virtual-list needs a real layout engine to measure item heights; jsdom
  // has none, so a virtualized option this far down the category list never
  // renders) — same fix already used in GaplamaTruckForm.test.tsx.
  return render(
    <ConfigProvider locale={enUS} virtual={false}>
      <QueryClientProvider client={queryClient}>
        <OptionListsTab canWrite />
      </QueryClientProvider>
    </ConfigProvider>,
  );
}

async function selectBlockCategory() {
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(await screen.findByText('Block'));
}

describe('OptionListsTab — block quick-list carry_days payload', () => {
  it('sends carry_days 7 when creating a new block', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockResolvedValue({ data: block() });

    renderTab();
    await selectBlockCategory();

    // antd's PlusOutlined contributes its own "plus" aria-label ahead of the
    // button's own text, so the accessible name is "plus Add", not "Add".
    await userEvent.click(screen.getByRole('button', { name: /Add/i }));

    // `{ selector: 'input' }` excludes the table's sortable "Code" column
    // header, which also carries a matching aria-label.
    const codeInput = await screen.findByLabelText('Code', { selector: 'input' });
    await userEvent.type(codeInput, 'Z');

    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/greenhouse/admin/blocks/');
    expect(body).toMatchObject({ code: 'Z', carry_days: 7 });
  });

  it('sends no carry_days key at all when editing an unrelated field on an existing block', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/greenhouse/admin/blocks/')) {
        return Promise.resolve({ data: [block({ id: 9, code: 'Q', name: 'Old Name', carry_days: 25 })] });
      }
      return Promise.resolve({ data: [] });
    });
    vi.mocked(api.patch).mockResolvedValue({ data: block() });

    renderTab();
    await selectBlockCategory();

    const row = (await screen.findByText('Q')).closest('tr');
    if (!row) throw new Error('row for Q not found');
    await userEvent.click(within(row).getByRole('button', { name: 'edit' }));

    // `{ selector: 'input' }` excludes the table's sortable "Name" column
    // header, which also carries a matching aria-label.
    const nameInput = await screen.findByLabelText('Name', { selector: 'input' });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Name');

    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.patch).mock.calls[0];
    expect(url).toBe('/greenhouse/admin/blocks/9/');
    expect(body).toMatchObject({ name: 'New Name' });
    expect(body).not.toHaveProperty('carry_days');
  });
});
