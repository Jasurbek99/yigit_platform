import { drfFieldErrors, NON_FIELD_KEYS } from '@/utils/drfErrors';
import type { ISeller } from '../../hooks/useSellers';

/** First message per field; `_` holds the form-level one. */
export type FieldErrors = Record<string, string>;

/** DRF `{field: [msg]}` → first message per field; a non-field message (or no body: `fallback`) lands under `_`. */
export function teamFormErrors(err: unknown, fallback: string): FieldErrors {
  const fields = drfFieldErrors(err);
  if (!fields) return { _: fallback };
  const out: FieldErrors = {};
  for (const [key, messages] of Object.entries(fields)) {
    out[NON_FIELD_KEYS.includes(key) ? '_' : key] = messages[0] ?? fallback;
  }
  return out;
}

/** «Имя, Базар» — the seller's name (or login) and bazaar. */
export function sellerLabel(s: ISeller): string {
  const name = [s.first_name, s.last_name].filter(Boolean).join(' ') || s.username;
  return s.bazaar ? `${name}, ${s.bazaar.name}` : name;
}
