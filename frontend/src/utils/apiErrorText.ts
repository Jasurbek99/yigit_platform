// The i18next singleton that '@/i18n' initialises; importing it directly keeps this util free of the react-i18next setup.
import i18n from 'i18next';

/** Machine error codes the API sends in place of a message; each has an `errors.<code>` label. */
const TRANSLATED_ERROR_CODES = new Set(['mixed_product', 'product_mismatch', 'contract_product_mismatch']);

/** Turns a known API error code into its translated message; any other text is returned as-is. */
export function localizeErrorCode(message: string): string {
  return TRANSLATED_ERROR_CODES.has(message) ? i18n.t(`errors.${message}`) : message;
}

/** The `{error}` text of a failed API call (translated when it is a known code), else `fallback`. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: unknown } } })?.response?.data;
  return typeof data?.error === 'string' && data.error ? localizeErrorCode(data.error) : fallback;
}
