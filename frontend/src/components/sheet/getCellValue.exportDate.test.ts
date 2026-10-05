import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@/i18n';
import { getCellValue } from './getCellValue';
import type { IShipmentSheetItem, IRowConfig } from '@/types';

/** «Дата экспорта» (export_date) is a plain ISO date: the Sheet shows DD.MM.YYYY, not an em-dash. */
const ship = (export_date: string) => ({ export_date }) as IShipmentSheetItem;
const row = { field_key: 'export_date' } as IRowConfig;

describe('getCellValue — export_date', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('formats the effective date as DD.MM.YYYY', () => {
    expect(getCellValue(ship('2026-09-30'), row)).toBe('30.09.2026');
  });
});
