import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@/i18n';
import { getCellValue } from './getCellValue';
import type { IShipmentSheetItem, IRowConfig } from '@/types';

/**
 * «Peregruz barmy?» (docs/Tasks.md item 31): has_peregruz is tri-state. An
 * unanswered cell must read empty, and an explicit «No» must read as an answer —
 * before 2026-09-29 «No» rendered '—', indistinguishable from «not asked».
 */
const ship = (has_peregruz: boolean | null) => ({ has_peregruz }) as IShipmentSheetItem;
const row = { field_key: 'has_peregruz' } as IRowConfig;

describe('getCellValue — has_peregruz', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('unanswered reads empty', () => {
    expect(getCellValue(ship(null), row)).toBe('—');
  });

  it('an explicit no reads as No', () => {
    expect(getCellValue(ship(false), row)).toBe('No');
  });

  it('yes reads as Yes', () => {
    expect(getCellValue(ship(true), row)).toBe('Yes');
  });
});
