import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { BlockSelect } from './BlockSelect';

vi.mock('@/hooks/useAdmin', () => ({
  useGreenhouseBlocks: () => ({
    data: [
      { id: 1, code: 'A', name: 'A', is_active: true },
      { id: 2, code: 'B', name: 'B', is_active: true },
    ],
    isLoading: false,
  }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// Type-level proof the discriminated union actually discriminates (never
// invoked — `tsc --noEmit` failing to error here would mean the union
// collapsed to something both branches accept).
function typeGuardMultipleRejectsScalarValue() {
  // @ts-expect-error mode="multiple" must not accept a scalar `value`
  return <BlockSelect mode="multiple" value={1} />;
}
function typeGuardSingleRejectsArrayValue() {
  // @ts-expect-error default (single) mode must not accept an array `value`
  return <BlockSelect value={[1]} />;
}
void typeGuardMultipleRejectsScalarValue;
void typeGuardSingleRejectsArrayValue;

describe('BlockSelect', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('single-select (default) emits a number', async () => {
    const onChange = vi.fn();
    wrap(<BlockSelect value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('A'));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('mode="multiple" emits an array of ids', async () => {
    const onChange = vi.fn();
    wrap(<BlockSelect mode="multiple" value={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('A'));
    expect(onChange).toHaveBeenCalledWith([1]);
  });
});
