import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '@/i18n';
import type { AxiosError } from 'axios';
import { localizeErrorCode } from './apiErrorText';
import { extractPatchError } from '@/hooks/useShipmentPatch';

const MIXED_RU = 'В одной фуре нельзя смешивать томат и перец';
const MISMATCH_RU = 'Продукт блоков не совпадает с продуктом рейса';

describe('localizeErrorCode', () => {
  beforeAll(async () => { await i18n.changeLanguage('ru'); });

  it('translates the two product error codes', () => {
    expect(localizeErrorCode('mixed_product')).toBe(MIXED_RU);
    expect(localizeErrorCode('product_mismatch')).toBe(MISMATCH_RU);
  });

  it('passes any other message through untouched', () => {
    expect(localizeErrorCode('Role cannot edit this field.')).toBe('Role cannot edit this field.');
  });

  it('is applied to a PATCH {error} body', () => {
    const err = { response: { data: { error: 'mixed_product' } } } as AxiosError;
    expect(extractPatchError(err, 'fallback')).toBe(MIXED_RU);
  });

  it('is applied to a PATCH field-error body {product_type: [code]}', () => {
    const err = { response: { data: { product_type: ['product_mismatch'] } } } as AxiosError;
    expect(extractPatchError(err, 'fallback')).toBe(MISMATCH_RU);
  });
});
