/**
 * Sera Bütçe module — local design tokens + formatting helpers.
 *
 * This is a UI-only prototype module cloned from the "Sera Bütçe Yönetimi"
 * app and adapted to the YGT platform (Ant Design). It keeps the source app's
 * green identity via a small local palette while using AntD primitives.
 *
 * All strings in this module are hardcoded Turkmen/Turkish (matching the
 * source app) — the prototype deliberately skips the platform i18n layer.
 */

export const SERA = {
  // Greens (source brand)
  green: '#0f7a52',
  greenDark: '#0b5e3f',
  greenLight: '#e8f5ee',
  greenSoft: '#f1faf5',
  emerald: '#10b981',

  // Accent surfaces used by header banners per page
  red: '#b91c1c',
  redDark: '#991b1b',
  blue: '#2563eb',
  amber: '#d97706',
  purple: '#7c3aed',
  slate: '#334155',

  // Neutrals
  ink: '#1f2937',
  sub: '#6b7280',
  line: '#e5e7eb',
  bg: '#f2f7f4',
  card: '#ffffff',

  // Semantic
  pos: '#059669',
  neg: '#dc2626',
} as const;

/** Turkish/Turkmen number format: "59.896.650" (dot thousands, comma decimal). */
export function fmtNum(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('tr-TR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtKg(value: number | null | undefined): string {
  return `${fmtNum(value)} kg`;
}

export function fmtUsd(value: number | null | undefined): string {
  return `${fmtNum(value)} $`;
}

export function fmtDtm(value: number | null | undefined): string {
  return `${fmtNum(value)} DTM`;
}

export function fmtPct(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `%${fmtNum(value, decimals)}`;
}
