import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { lotFixture } from '../../testFixtures';
import { checkReceipt, receiptBody, receiptForm } from './receiptState';

const pending = lotFixture({ boxes_received: 1, boxes_per_pallet: 60, needs_receipt: true });
const confirmed = lotFixture({ boxes_received: 100, boxes_per_pallet: 50, tare_g: 450 });

describe('receiptState', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  it('leaves boxes and boxes per pallet blank while the receipt is pending', () => {
    const form = receiptForm(pending);
    expect(form.boxes).toBe('');
    expect(form.perPallet).toBe('');
    expect(Object.keys(checkReceipt(form) ?? {})).toEqual(['boxes_received', 'boxes_per_pallet']);
  });

  it('sends both counts of a pending receipt even when per pallet equals the stored value', () => {
    const form = { ...receiptForm(pending), boxes: '300', perPallet: '60' };
    expect(receiptBody(form, pending)).toEqual({ boxes_received: 300, boxes_per_pallet: 60 });
  });

  it('keeps today behaviour for a confirmed lot', () => {
    const form = receiptForm(confirmed);
    expect(form).toMatchObject({ boxes: '100', perPallet: '50' });
    expect(checkReceipt(form)).toBeNull();
    expect(receiptBody(form, confirmed)).toEqual({});
    expect(receiptBody({ ...form, perPallet: '55' }, confirmed)).toEqual({ boxes_per_pallet: 55 });
  });
});
