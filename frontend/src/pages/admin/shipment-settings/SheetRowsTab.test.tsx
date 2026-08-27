import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Modal } from 'antd';
import i18n from '@/i18n';
import SheetRowsTab from './SheetRowsTab';
import type { ISheetRowSetting } from '@/types';
import {
  useSheetRowSettings,
  useSaveSheetRowSetting,
  useReorderSheetRows,
  useSoftDeleteSheetRow,
  useCreateCustomSheetRow,
} from '@/hooks/useSheetRowSettings';

vi.mock('@/hooks/useSheetRowSettings', () => ({
  useSheetRowSettings: vi.fn(),
  useSaveSheetRowSetting: vi.fn(),
  useReorderSheetRows: vi.fn(),
  useSoftDeleteSheetRow: vi.fn(),
  useCreateCustomSheetRow: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const CONFIRM_BODY = 'This row has unsaved changes. Switch rows and lose them?';

const saveMutateAsync = vi.fn();

function makeRow(over: Partial<ISheetRowSetting>): ISheetRowSetting {
  return {
    id: 1, field_key: 'harvest_block', row_number: 1, display_order: 1024,
    is_visible: true, is_locked: false, role_group: '', is_custom: false,
    label_tk: '', label_ru: '', label_en: '',
    who_tk: '', who_ru: '', who_en: '',
    description_tk: '', description_ru: '', description_en: '',
    style_width: null, style_align: null, style_color: null, style_font_color: null,
    style_font_weight: '', style_font_style: '', style_font_family: '', style_font_size: null,
    triggered_user: null, triggered_user_name: null, triggered_user_active: null,
    triggered_roles: [], extra_users: [],
    version: 7, updated_at: '2026-08-01T10:00:00Z', updated_by_name: 'Admin',
    deleted_at: null, default_label_key: null, default_who_key: null,
    ...over,
  };
}

const ROWS = [
  makeRow({ id: 1, field_key: 'harvest_block' }),
  makeRow({ id: 2, field_key: 'weight_net', label_en: 'Net weight', version: 3 }),
  makeRow({ id: 3, field_key: 'customer', label_en: 'Customer', version: 5 }),
];

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SheetRowsTab canWrite />
    </QueryClientProvider>,
  );
}

describe('SheetRowsTab', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    saveMutateAsync.mockResolvedValue(ROWS[0]);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    vi.mocked(useSheetRowSettings).mockReturnValue({ data: ROWS, isLoading: false } as any);
    vi.mocked(useSaveSheetRowSetting).mockReturnValue({
      mutateAsync: saveMutateAsync, isPending: false,
    } as any);
    vi.mocked(useReorderSheetRows).mockReturnValue({ mutate: vi.fn() } as any);
    vi.mocked(useSoftDeleteSheetRow).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
    vi.mocked(useCreateCustomSheetRow).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  // Modal.confirm renders into its own root outside the React tree, so RTL's
  // cleanup does not remove it — a leftover dialog would be counted by the next
  // test's queries.
  afterEach(() => {
    Modal.destroyAll();
    vi.restoreAllMocks();
  });

  it('sends every edited field in ONE PATCH — a second call would carry a stale version', async () => {
    renderTab();
    fireEvent.change(screen.getByLabelText('label_en'), { target: { value: 'Harvest block' } });
    // Switch order: [0] visibility (header), [1] lock (access section).
    fireEvent.click(screen.getAllByRole('switch')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveMutateAsync).toHaveBeenCalledTimes(1));
    expect(saveMutateAsync).toHaveBeenCalledWith({
      id: 1, version: 7, label_en: 'Harvest block', is_locked: true,
    });
  });

  it('states the access rule the backend actually applies, and follows the lock', () => {
    renderTab();
    // No lock, no triggers → the field permission alone decides.
    expect(screen.getByText(/^No lock, no triggers:/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('switch')[1]);
    expect(screen.getByText(/^Locked with no role selected:/)).toBeInTheDocument();
  });

  it('says the roles decide — and that the lock stops mattering — once one is set', () => {
    vi.mocked(useSheetRowSettings).mockReturnValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [makeRow({ id: 9, field_key: 'weight_net', triggered_roles: ['transport'] })],
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderTab();
    expect(screen.getByText(/^Only the roles selected below/)).toBeInTheDocument();
    // Same sentence with the lock on — locked and unlocked agree once a role is set.
    fireEvent.click(screen.getAllByRole('switch')[1]);
    expect(screen.getByText(/^Only the roles selected below/)).toBeInTheDocument();
  });

  it('keeps Save disabled until something actually changes', () => {
    renderTab();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('who_ru'), { target: { value: 'Soltanmyrat' } });
    expect(save).toBeEnabled();
  });

  it('asks before switching rows with unsaved changes, and stays on the edited row', () => {
    const confirmSpy = vi.spyOn(Modal, 'confirm');
    renderTab();
    fireEvent.change(screen.getByLabelText('label_en'), { target: { value: 'edited' } });
    fireEvent.click(screen.getByText('Net weight'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0].content).toBe(CONFIRM_BODY);
    expect(screen.getByLabelText('label_en')).toHaveValue('edited');
  });

  it('does not stack a second confirm when another row is clicked while one is open', () => {
    const confirmSpy = vi.spyOn(Modal, 'confirm');
    renderTab();
    fireEvent.change(screen.getByLabelText('label_en'), { target: { value: 'edited' } });
    fireEvent.click(screen.getByText('Net weight'));
    fireEvent.click(screen.getByText('Customer'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});
