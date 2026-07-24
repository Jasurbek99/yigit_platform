/**
 * Umumy Dolandyryş Çykdajylary (770 — Genel Yönetim Giderleri) — page-specific mock data.
 *
 * Figures transcribed from the source "Sera Bütçe Yönetimi" app screen. UI-only
 * prototype — no API, no i18n (hardcoded Turkmen/Turkish per source app).
 */

/** Manually-entered line-item labels under "Dolandyryş Çykdajylary". */
export const ADMIN_ITEM_LABELS: readonly string[] = [
  'Dolandyryş — Resmi Dokument Tazelemek Üçin Çykdaj',
  'Dolandyryş — Telekeçiler Birleşigi Giderleri',
  'Dolandyryş — Awtoulag Remont We Bejergi Çykdajylary',
  'Dolandyryş — Bank Çykdajylary',
  'Dolandyryş — Taksi Çykdajylary',
  'Dolandyryş — IK Çykdajylar',
  'Dolandyryş — Naharhana Çykdajylary',
  'Dolandyryş — Konselyar Harytlar Çykdajylary',
  'Dolandyryş — Fuar Çykdajylary',
  'Dolandyryş — Reklama Çykdajylary',
];

/** Manually-entered line-item labels under "Ofis Çykdajylary". */
export const OFFICE_ITEM_LABELS: readonly string[] = [
  'Ofis — Arenda Çykdajylary',
  'Ofis — Beýleki Çykdajylary',
];

/** Average headcount (12-month) per block — used in the "Bloklara Dağılım" table. Blocks not listed = 0. */
export const PERSONEL_BY_BLOCK: Readonly<Record<string, number>> = {
  'DUS-A': 87,
  'DUS-B': 87,
};

/** Read-only related cost-center strips shown at the bottom of the page (760.0x — not part of 770). */
export interface MiniExpenseStripData {
  readonly code: string;
  readonly title: string;
  readonly months: readonly number[]; // 12 values
  readonly total: number;
  readonly color: string;
  readonly bg: string;
}

export const MINI_EXPENSE_STRIPS: readonly MiniExpenseStripData[] = [
  {
    code: '760.03',
    title: 'Nakliye Giderleri',
    months: [697307, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    total: 697307,
    color: '#c2410c',
    bg: '#fff7ed',
  },
  {
    code: '760.04',
    title: 'Gümrükleme Giderleri',
    months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    total: 0,
    color: '#7c3aed',
    bg: '#f5f3ff',
  },
  {
    code: '760.05',
    title: 'Dış Satış Giderleri',
    months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    total: 0,
    color: '#be123c',
    bg: '#fdf2f8',
  },
];
