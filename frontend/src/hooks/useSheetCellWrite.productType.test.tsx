import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSheetCellWrite, isClearableField } from './useSheetCellWrite';
import type { IRowConfig, IShipmentSheetItem } from '@/types';

const patch = vi.fn(() => Promise.resolve({ data: {} }));
const post = vi.fn(() => Promise.resolve({ data: {} }));
vi.mock('@/services/api', () => ({ default: { patch: (...a: unknown[]) => patch(...(a as [])), post: (...a: unknown[]) => post(...(a as [])), get: vi.fn() } }));
vi.mock('@/hooks/useSeasonParam', () => ({ useSelectedSeason: () => ({ seasonId: 1 }) }));

const PRODUCT_ROW = {
  row_number: 51, field_key: 'product_type', default_who_key: '', label_key: 'sheet.row.product_type',
  input_type: 'dropdown', options_source: 'productTypes', style: 'base',
} as IRowConfig;
const PEPPER = { id: 5, product_type: 2, product_type_code: 'pepper', product_type_name: 'Bolgar burç' } as IShipmentSheetItem;

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useSheetCellWrite(), { wrapper }).result.current;
}

describe('product cell is never cleared', () => {
  beforeEach(() => { patch.mockClear(); post.mockClear(); });

  it('is not a clearable field (Delete, Cut and the context menu all gate on this)', () => {
    expect(isClearableField(PRODUCT_ROW)).toBe(false);
  });

  it('clearCell sends nothing', () => {
    setup().clearCell(PEPPER, PRODUCT_ROW);
    expect(patch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('pasting an empty value into it sends nothing', () => {
    setup().writeCell(PEPPER, PRODUCT_ROW, null);
    expect(patch).not.toHaveBeenCalled();
  });

  it('a real product pick is still written', async () => {
    setup().writeCell(PEPPER, PRODUCT_ROW, 1);
    await vi.waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/export/shipments/5/', { product_type: 1 });
  });
});
