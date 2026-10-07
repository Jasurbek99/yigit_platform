import i18n from '@/i18n';

/** Machine error codes the API sends in place of a message; each has an `errors.<code>` label. */
const TRANSLATED_ERROR_CODES = new Set(['mixed_product', 'product_mismatch']);

/** Turns a known API error code into its translated message; any other text is returned as-is. */
export function localizeErrorCode(message: string): string {
  return TRANSLATED_ERROR_CODES.has(message) ? i18n.t(`errors.${message}`) : message;
}
