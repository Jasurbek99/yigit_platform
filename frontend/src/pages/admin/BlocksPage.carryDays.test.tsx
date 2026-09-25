import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import BlocksPage from './BlocksPage';
import {
  useAdminBlocks,
  useCreateBlock,
  useUpdateBlock,
  useAdminUsers,
  useLoadingLocations,
  useTomatoVarieties,
  useGreenhouseBlocks,
  useBlockAssignments,
} from '@/hooks/useAdmin';
import type { IGreenhouseBlock } from '@/types';

vi.mock('@/hooks/useAdmin', () => ({
  useAdminBlocks: vi.fn(),
  useCreateBlock: vi.fn(),
  useUpdateBlock: vi.fn(),
  useAdminUsers: vi.fn(),
  useLoadingLocations: vi.fn(),
  useTomatoVarieties: vi.fn(),
  useGreenhouseBlocks: vi.fn(),
  useBlockAssignments: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function block(overrides: Partial<IGreenhouseBlock> = {}): IGreenhouseBlock {
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
    sub_blocks: [],
    carry_days: 7,
    ...overrides,
  };
}

const noopMutation = { mutate: vi.fn(), isPending: false };

// i18n falls back to Turkmen; these assertions read the English strings.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCreateBlock).mockReturnValue(noopMutation as never);
  vi.mocked(useUpdateBlock).mockReturnValue(noopMutation as never);
  vi.mocked(useAdminUsers).mockReturnValue({ data: [], isLoading: false } as never);
  vi.mocked(useLoadingLocations).mockReturnValue({ data: [] } as never);
  vi.mocked(useTomatoVarieties).mockReturnValue({ data: [] } as never);
  vi.mocked(useGreenhouseBlocks).mockReturnValue({ data: [], isLoading: false } as never);
  vi.mocked(useBlockAssignments).mockReturnValue({ data: [], isLoading: false } as never);
});

function renderWith(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openEditDrawer(code: string) {
  const row = (await screen.findByText(code)).closest('tr');
  if (!row) throw new Error(`row for code ${code} not found`);
  await userEvent.click(within(row).getByRole('button'));
}

describe('BlocksPage — carry_days field', () => {
  it('renders the field with the block\'s current value when editing an existing block', async () => {
    vi.mocked(useAdminBlocks).mockReturnValue({
      data: [block({ id: 3, code: 'C', carry_days: 12 })],
      isLoading: false,
    } as never);

    renderWith(<BlocksPage />);
    await openEditDrawer('C');

    const input = await screen.findByLabelText('Storage window (days)');
    expect(input).toHaveValue('12');
  });

  it('sends the block\'s existing carry_days when only an unrelated field is edited', async () => {
    const updateMutate = vi.fn();
    vi.mocked(useUpdateBlock).mockReturnValue({ mutate: updateMutate, isPending: false } as never);
    vi.mocked(useAdminBlocks).mockReturnValue({
      data: [block({ id: 5, code: 'D', name: 'Old Name', carry_days: 20 })],
      isLoading: false,
    } as never);

    renderWith(<BlocksPage />);
    await openEditDrawer('D');

    const nameInput = await screen.findByLabelText('Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Name');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 5, name: 'New Name', carry_days: 20 }),
      );
    });
  });

  it('sends carry_days 7 when creating a new block with the field untouched', async () => {
    const createMutate = vi.fn();
    vi.mocked(useCreateBlock).mockReturnValue({ mutate: createMutate, isPending: false } as never);
    vi.mocked(useAdminBlocks).mockReturnValue({ data: [], isLoading: false } as never);

    renderWith(<BlocksPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Block' }));

    const codeInput = await screen.findByLabelText('Block Code');
    await userEvent.type(codeInput, 'Z');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ code: 'Z', carry_days: 7 }));
    });
  });

  it('refuses a value above 30 and does not save', async () => {
    const createMutate = vi.fn();
    vi.mocked(useCreateBlock).mockReturnValue({ mutate: createMutate, isPending: false } as never);
    vi.mocked(useAdminBlocks).mockReturnValue({ data: [], isLoading: false } as never);

    renderWith(<BlocksPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Block' }));

    const codeInput = await screen.findByLabelText('Block Code');
    await userEvent.type(codeInput, 'Z');

    const carryInput = screen.getByLabelText('Storage window (days)');
    await userEvent.clear(carryInput);
    await userEvent.type(carryInput, '31');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Must be between 1 and 30 days')).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('refuses a value below 1 and does not save', async () => {
    const createMutate = vi.fn();
    vi.mocked(useCreateBlock).mockReturnValue({ mutate: createMutate, isPending: false } as never);
    vi.mocked(useAdminBlocks).mockReturnValue({ data: [], isLoading: false } as never);

    renderWith(<BlocksPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Block' }));

    const codeInput = await screen.findByLabelText('Block Code');
    await userEvent.type(codeInput, 'Z');

    const carryInput = screen.getByLabelText('Storage window (days)');
    await userEvent.clear(carryInput);
    await userEvent.type(carryInput, '0');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Must be between 1 and 30 days')).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('blocks saving instead of silently defaulting to 7 when the field is cleared during an edit', async () => {
    // This is the exact shape of the bug the earlier exclusion prevented:
    // a hardcoded fallback silently overwriting a real value. `required`
    // must stop the save, not let a `?? 7` fallback slip a wrong value through.
    const updateMutate = vi.fn();
    vi.mocked(useUpdateBlock).mockReturnValue({ mutate: updateMutate, isPending: false } as never);
    vi.mocked(useAdminBlocks).mockReturnValue({
      data: [block({ id: 9, code: 'E', carry_days: 15 })],
      isLoading: false,
    } as never);

    renderWith(<BlocksPage />);
    await openEditDrawer('E');

    const carryInput = await screen.findByLabelText('Storage window (days)');
    await userEvent.clear(carryInput);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });
});
