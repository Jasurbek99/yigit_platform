// No antd / i18n imports: the market app (/m/) shares this file with the main app.

/** Body keys DRF and our exception handler use for a message that belongs to no field. */
export const NON_FIELD_KEYS: readonly string[] = ['error', 'detail', 'non_field_errors'];

/** `err.response` of a failed axios call, narrowed without a cast (plain objects in tests pass too). */
function responseOf(err: unknown): object | null {
  if (typeof err !== 'object' || err === null || !('response' in err)) return null;
  const { response } = err;
  return typeof response === 'object' && response !== null ? response : null;
}

/** HTTP status of a failed API call, or undefined (network error, not an HTTP error). */
export function httpStatus(err: unknown): number | undefined {
  const response = responseOf(err);
  if (!response || !('status' in response)) return undefined;
  return typeof response.status === 'number' ? response.status : undefined;
}

/** A failed call's JSON body as `{key: [messages]}` (DRF `{field: [msg]}` or `{error: msg}`); null without one. */
export function drfFieldErrors(err: unknown): Record<string, string[]> | null {
  const response = responseOf(err);
  const data = response && 'data' in response ? response.data : null;
  if (typeof data !== 'object' || data === null) return null;
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return out;
}

/** The field errors of `err` for the fields `isField` accepts, shaped for Ant Design `form.setFields`. */
export function formFieldErrors<K extends string>(
  err: unknown,
  isField: (name: string) => name is K,
): Array<{ name: K; errors: string[] }> {
  return Object.entries(drfFieldErrors(err) ?? {})
    .filter((entry): entry is [K, string[]] => isField(entry[0]))
    .map(([name, errors]) => ({ name, errors }));
}
