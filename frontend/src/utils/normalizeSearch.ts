/**
 * Normalize a string for forgiving search.
 *
 *  - lowercases
 *  - strips Latin diacritics (o-umlaut to o, s-cedilla to s, g-breve to g, ...)
 *    via NFD + combining-mark removal (U+0300 to U+036F)
 *  - treats every non-letter / non-digit character (quotes, dashes, dots,
 *    parentheses, slashes, ...) as whitespace
 *  - collapses runs of whitespace
 *
 * Cyrillic and other scripts are preserved (only Latin diacritics decompose).
 */
export function normalizeSearch(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Combine several searchable fields into one normalized blob. */
export function buildSearchBlob(parts: Array<string | null | undefined>): string {
  return normalizeSearch(parts.filter(Boolean).join(' '));
}
