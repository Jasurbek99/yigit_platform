import { describe, it, expect } from 'vitest';
import type { IRowConfig, SheetInputType } from '@/types';
import type { ISheetClipboardEntry } from '@/stores/sheetStore';
import { decidePaste } from './useSheetClipboard';

function row(field_key: string, input_type: SheetInputType): IRowConfig {
  return {
    row_number: 1,
    field_key,
    default_who_key: '',
    label_key: '',
    input_type,
    style: 'base',
  };
}

function clip(
  fieldKey: string,
  inputType: SheetInputType,
  rawValue: unknown = 'x',
  displayText = 'x',
): ISheetClipboardEntry {
  return { fieldKey, inputType, rawValue, displayText };
}

describe('decidePaste', () => {
  it('same field → raw (carries the stored raw value through the field save path)', () => {
    expect(decidePaste(row('notes', 'text'), clip('notes', 'text'))).toEqual({ kind: 'raw' });
  });

  it('same FK/dropdown field → raw (id/code round-trips, even though it is not free-text)', () => {
    expect(decidePaste(row('country', 'dropdown'), clip('country', 'dropdown', 5))).toEqual({
      kind: 'raw',
    });
  });

  it('same date field → raw', () => {
    expect(decidePaste(row('departed_at', 'datetime'), clip('departed_at', 'datetime'))).toEqual({
      kind: 'raw',
    });
  });

  it('different fields, both free-text (text ↔ phone) → text', () => {
    expect(decidePaste(row('driver_name', 'text'), clip('driver_phone', 'phone'))).toEqual({
      kind: 'text',
    });
  });

  it('different fields, text → number → reject (no cross-type coercion)', () => {
    expect(decidePaste(row('weight_net', 'number'), clip('notes', 'text'))).toEqual({
      kind: 'reject',
    });
  });

  it('different FK fields → reject (an id from country must not land in customer)', () => {
    expect(decidePaste(row('customer', 'dropdown'), clip('country', 'dropdown', 5))).toEqual({
      kind: 'reject',
    });
  });

  it('different fields, dropdown → text → reject (a code is not a free-text string)', () => {
    expect(decidePaste(row('notes', 'text'), clip('country', 'dropdown'))).toEqual({
      kind: 'reject',
    });
  });
});
