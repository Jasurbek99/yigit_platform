import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { CustomsExpenseCategorySelect } from './CustomsExpenseCategorySelect';

const mockMutate = vi.fn();

vi.mock('@/hooks/useCustomsExpenses', () => ({
  useCustomsExpenseCategories: () => ({
    data: [
      { id: 1, code: 'GUMRUKLEME', label_tk: 'Gümrüklemek', label_ru: null, label_en: null, sort_order: 10, is_active: true },
      { id: 2, code: 'YOL_HAKY', label_tk: 'Ýol haky', label_ru: null, label_en: null, sort_order: 20, is_active: true },
    ],
    isLoading: false,
  }),
  useCustomsExpenseCategoryLabel: () => (code: string) =>
    code === 'GUMRUKLEME' ? 'Customs clearance' : 'Ýol haky',
  useCreateCustomsExpenseCategory: () => ({ mutate: mockMutate, isPending: false }),
}));

describe('CustomsExpenseCategorySelect — "Add new"', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    mockMutate.mockReset();
  });

  it('lists the categories and offers "Add new"', async () => {
    render(<CustomsExpenseCategorySelect />);
    await userEvent.click(screen.getByRole('combobox'));

    expect(await screen.findByText('Customs clearance')).toBeInTheDocument();
    expect(screen.getByText('Ýol haky')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add new/ })).toBeInTheDocument();
  });

  it('adds a category from the typed text and selects it', async () => {
    const onChange = vi.fn();
    mockMutate.mockImplementation((_payload, opts) =>
      opts.onSuccess({ id: 3, code: 'MOHUR', label_tk: 'Möhür', label_ru: null, label_en: null, sort_order: 30, is_active: true }),
    );
    render(<CustomsExpenseCategorySelect onChange={onChange} />);

    await userEvent.type(screen.getByRole('combobox'), 'Möhür');
    await userEvent.click(screen.getByRole('button', { name: /Add new/ }));

    const nameInput = await screen.findByLabelText('Name (Turkmen)');
    expect(nameInput).toHaveValue('Möhür');

    await userEvent.type(screen.getByLabelText('Name (Russian)'), 'Печать');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate.mock.calls[0][0]).toEqual({ label_tk: 'Möhür', label_ru: 'Печать' });
    expect(onChange).toHaveBeenCalledWith('MOHUR');
  });

  it('does not save without a Turkmen name', async () => {
    render(<CustomsExpenseCategorySelect />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('button', { name: /Add new/ }));
    await screen.findByLabelText('Name (Turkmen)');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
