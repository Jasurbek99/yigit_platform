import { describe, it, expect } from 'vitest';
import { parseNumberInput } from './SheetCellEditor';

// Locks the B.1 fix: typing literal `0` in a number cell MUST persist as 0,
// not get coerced to null. Previously `Number(value) || null` was treating
// rejected_weight_kg=0 ("no rejection") as null ("not measured yet").
describe('parseNumberInput', () => {
  it('preserves literal zero', () => {
    expect(parseNumberInput('0')).toBe(0);
    expect(parseNumberInput(' 0 ')).toBe(0);
    expect(parseNumberInput('0.0')).toBe(0);
  });

  it('parses positive numbers', () => {
    expect(parseNumberInput('42')).toBe(42);
    expect(parseNumberInput('18500.5')).toBe(18500.5);
  });

  it('parses negative numbers', () => {
    expect(parseNumberInput('-3')).toBe(-3);
  });

  it('returns null for empty input (cell clear)', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('   ')).toBeNull();
  });

  it('returns null for non-numeric garbage', () => {
    expect(parseNumberInput('abc')).toBeNull();
    expect(parseNumberInput('12abc')).toBeNull();
    expect(parseNumberInput('NaN')).toBeNull();
  });
});
