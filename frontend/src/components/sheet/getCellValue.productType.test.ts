import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@/i18n';
import { getCellValue } from './getCellValue';
import { TOPIC_SECTIONS } from './sheetTopicOrder';
import type { IShipmentSheetItem, IRowConfig } from '@/types';

/** «Продукт» (product_type): the Sheet shows the product's name; unknown reads as an em-dash. */
const row = { field_key: 'product_type' } as IRowConfig;

describe('getCellValue — product_type', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('shows the product name', () => {
    const ship = { product_type: 2, product_type_code: 'pepper', product_type_name: 'Bolgar burç' } as IShipmentSheetItem;
    expect(getCellValue(ship, row)).toBe('Bolgar burç');
  });

  it('shows a dash when the product is unknown', () => {
    const ship = { product_type: null, product_type_code: null, product_type_name: null } as IShipmentSheetItem;
    expect(getCellValue(ship, row)).toBe('—');
  });
});

describe('topic order — product_type', () => {
  it('sits right after variety', () => {
    const fields = TOPIC_SECTIONS.flatMap((s) => s.fields);
    expect(fields.indexOf('product_type')).toBe(fields.indexOf('variety') + 1);
  });
});
