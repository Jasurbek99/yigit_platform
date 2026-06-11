import { describe, it, expect } from 'vitest';
import type { IRowConfig, SheetInputType } from '@/types';
import { isJunctionField, isFreeTextType, isClearableField } from './useSheetCellWrite';

function row(
  field_key: string,
  input_type: SheetInputType,
  options_source?: string,
): IRowConfig {
  return {
    row_number: 1,
    field_key,
    default_who_key: '',
    label_key: '',
    input_type,
    style: 'base',
    options_source,
  };
}

describe('isJunctionField', () => {
  it('is true for firm_splits and block_sources', () => {
    expect(isJunctionField(row('firm_splits', 'multiselect'))).toBe(true);
    expect(isJunctionField(row('block_sources', 'multiselect'))).toBe(true);
  });

  it('is false for direct columns', () => {
    expect(isJunctionField(row('country', 'dropdown'))).toBe(false);
    expect(isJunctionField(row('notes', 'text'))).toBe(false);
  });
});

describe('isFreeTextType', () => {
  it('is true only for text and phone', () => {
    expect(isFreeTextType('text')).toBe(true);
    expect(isFreeTextType('phone')).toBe(true);
  });

  it('is false for typed inputs (number / dropdown / date / status)', () => {
    expect(isFreeTextType('number')).toBe(false);
    expect(isFreeTextType('dropdown')).toBe(false);
    expect(isFreeTextType('date')).toBe(false);
    expect(isFreeTextType('status')).toBe(false);
  });
});

describe('isClearableField', () => {
  it('is false for the primary identifier and computed flags', () => {
    expect(isClearableField(row('cargo_code', 'text'))).toBe(false);
    expect(isClearableField(row('has_doc_advance', 'readonly'))).toBe(false);
    expect(isClearableField(row('has_sales_report', 'readonly'))).toBe(false);
  });

  it('is false for bool-backed dropdowns (pick "no" instead of clearing)', () => {
    expect(isClearableField(row('has_peregruz', 'dropdown', 'peregruz'))).toBe(false);
    expect(isClearableField(row('vehicle_condition', 'dropdown', 'gornushi'))).toBe(false);
  });

  it('is true for ordinary scalar, FK, and junction fields', () => {
    expect(isClearableField(row('notes', 'text'))).toBe(true);
    expect(isClearableField(row('country', 'dropdown'))).toBe(true);
    expect(isClearableField(row('firm_splits', 'multiselect'))).toBe(true);
  });
});
