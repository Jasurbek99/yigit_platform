import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import BlockDetailPage from './BlockDetailPage';
import {
  useAdminBlock,
  useTomatoVarieties,
  useCreateBlock,
  useUpdateBlock,
} from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IGreenhouseBlock, IGreenhouseBlockSub } from '@/types';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ id: '1' }) };
});

vi.mock('@/hooks/useAdmin', () => ({
  useAdminBlock: vi.fn(),
  useTomatoVarieties: vi.fn(),
  useCreateBlock: vi.fn(),
  useUpdateBlock: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function subBlock(overrides: Partial<IGreenhouseBlockSub> = {}): IGreenhouseBlockSub {
  return {
    id: 42,
    code: 'F1',
    name: 'Old Name',
    variety_main: null,
    variety_main_name: null,
    variety_secondary: null,
    variety_secondary_name: null,
    area_m2: null,
    section_count: null,
    sowing_date: null,
    is_active: true,
    ...overrides,
  };
}

function parentBlock(subBlocks: IGreenhouseBlockSub[] = []): IGreenhouseBlock {
  return {
    id: 1,
    code: 'A',
    name: 'A-Greenhouse',
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
    sub_blocks: subBlocks,
    carry_days: 7,
  };
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useTomatoVarieties).mockReturnValue({ data: [] } as never);
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, role: 'admin', is_superuser: true },
  } as never);
});

function renderWith(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BlockDetailPage — sub-block carry_days payload', () => {
  it('sends carry_days 7 when creating a new sub-block', async () => {
    const createMutate = vi.fn();
    vi.mocked(useCreateBlock).mockReturnValue({ mutate: createMutate, isPending: false } as never);
    vi.mocked(useUpdateBlock).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
    vi.mocked(useAdminBlock).mockReturnValue({
      data: parentBlock([]),
      isLoading: false,
      isError: false,
    } as never);

    renderWith(<BlockDetailPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add Inner Block' }));

    const codeInput = await screen.findByLabelText('Inner Block Code');
    await userEvent.type(codeInput, 'F2');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ code: 'F2', carry_days: 7 }));
    });
  });

  it('sends no carry_days key at all when editing an unrelated field on an existing sub-block', async () => {
    const updateMutate = vi.fn();
    vi.mocked(useCreateBlock).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
    vi.mocked(useUpdateBlock).mockReturnValue({ mutate: updateMutate, isPending: false } as never);
    vi.mocked(useAdminBlock).mockReturnValue({
      data: parentBlock([subBlock({ id: 42, code: 'F1', name: 'Old Name' })]),
      isLoading: false,
      isError: false,
    } as never);

    renderWith(<BlockDetailPage />);

    const row = (await screen.findByText('F1')).closest('tr');
    if (!row) throw new Error('row for F1 not found');
    await userEvent.click(within(row).getByRole('button'));

    const nameInput = await screen.findByLabelText('Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Name');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    const payload = updateMutate.mock.calls[0][0];
    expect(payload).toMatchObject({ id: 42, name: 'New Name' });
    expect(payload).not.toHaveProperty('carry_days');
  });
});
