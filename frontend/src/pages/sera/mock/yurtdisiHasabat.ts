/**
 * Sera — Daşary Ýurt Hasabaty (Yurtdışı Hasabat) mock dataset (2026).
 *
 * Transcribed verbatim from the source app's DOM snapshot
 * (`sera-ref/22-yurtdisi-hasabat.md`). Money/most kg figures are missing in
 * the source (rendered as "—") — kept as `null` here so the page can render
 * the same em-dash placeholders via the shared `fmt*` helpers.
 */

// ─── Top stat cards ────────────────────────────────────────────────────────
export const YURTDISI_STATS = {
  totalExportKg: 53000,
  totalContractUsd: null as number | null,
  receivedUsd: null as number | null,
  pendingUsd: null as number | null,
};

// ─── Firma boýunça eksport (firm export share) ─────────────────────────────
export interface IFirmShare {
  readonly code: string;
  readonly name: string;
  readonly pct: number;
  readonly kg: number;
  readonly usd: number | null;
  readonly color: string;
}

export const FIRM_SHARES: readonly IFirmShare[] = [
  { code: 'Y', name: 'Yigit', pct: 66, kg: 35000, usd: null, color: '#3730a3' },
  { code: 'H', name: 'Hemsaya', pct: 34, kg: 18000, usd: null, color: '#0d9488' },
];

// ─── Açyk Sertnamalar (open contracts) ─────────────────────────────────────
export interface IOpenContract {
  readonly code: string;
  readonly exporter: string;
  readonly totalKg: number;
  readonly shippedKg: number | null;
  readonly priceUsd: number;
  readonly shippedPct: number;
  readonly paymentPct: number;
  readonly remainingUsd: number | null;
}

export const OPEN_CONTRACTS: readonly IOpenContract[] = [
  { code: 'YGT001/26', exporter: 'Yigit', totalKg: 36000, shippedKg: null, priceUsd: 0.87, shippedPct: 0, paymentPct: 0, remainingUsd: null },
  { code: 'GB002/26', exporter: 'Gök Bulut', totalKg: 9000, shippedKg: null, priceUsd: 0.87, shippedPct: 0, paymentPct: 0, remainingUsd: null },
];

// ─── Şirket boýunça özet (importer summary table) ──────────────────────────
export interface ICompanySummary {
  readonly name: string;
  readonly count: number;
  readonly totalUsd: number | null;
  readonly receivedUsd: number | null;
  readonly remainingUsd: number | null;
  readonly deadlineNote: string | null;
  readonly overdue: boolean;
}

export const COMPANY_SUMMARY: readonly ICompanySummary[] = [
  { name: 'Nur-Alem', count: 3, totalUsd: null, receivedUsd: null, remainingUsd: null, deadlineNote: 'YGT001/26: 18g geçdi', overdue: true },
  { name: 'ŞAHFRUKT', count: 1, totalUsd: null, receivedUsd: null, remainingUsd: null, deadlineNote: null, overdue: false },
  { name: 'TURKMENFRUKT', count: 2, totalUsd: null, receivedUsd: null, remainingUsd: null, deadlineNote: null, overdue: false },
  { name: 'TransAsia Trade', count: 1, totalUsd: null, receivedUsd: null, remainingUsd: null, deadlineNote: null, overdue: false },
  { name: 'Aranşy - KZ', count: 2, totalUsd: null, receivedUsd: null, remainingUsd: null, deadlineNote: null, overdue: false },
  { name: 'Winta Plus', count: 2, totalUsd: null, receivedUsd: null, remainingUsd: null, deadlineNote: null, overdue: false },
  { name: 'Hususy telekeçi Tursynbaýew', count: 1, totalUsd: null, receivedUsd: null, remainingUsd: null, deadlineNote: null, overdue: false },
  { name: 'Näbelli', count: 2, totalUsd: null, receivedUsd: null, remainingUsd: null, deadlineNote: null, overdue: false },
];

export const COMPANY_SUMMARY_TOTAL = {
  totalUsd: null as number | null,
  receivedUsd: null as number | null,
  remainingUsd: null as number | null,
};

// ─── Sertname jemi tablasy (contracts total table) ─────────────────────────
export interface IContractRow {
  readonly no: number;
  readonly code: string | null;
  readonly exporter: string | null;
  readonly importer: string | null;
  readonly totalKg: number | null;
  readonly totalUsd: number | null;
  readonly shippedKg: number | null;
  readonly remainingKg: number | null;
  readonly receivedUsd: number | null;
  readonly remainingUsd: number | null;
  readonly deadline: string | null;
  readonly daysLeft: string | null;
}

export const CONTRACTS_TABLE: readonly IContractRow[] = [
  { no: 1, code: 'YGT001/26', exporter: 'Yigit', importer: 'Nur-Alem', totalKg: 36000, totalUsd: null, shippedKg: null, remainingKg: 36000, receivedUsd: null, remainingUsd: null, deadline: '2026-07-05', daysLeft: '-18 gün' },
  { no: 2, code: 'GB002/26', exporter: 'Gök Bulut', importer: 'Nur-Alem', totalKg: 9000, totalUsd: null, shippedKg: null, remainingKg: 9000, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 3, code: 'YGT002/26', exporter: 'Yigit', importer: 'ŞAHFRUKT', totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 4, code: 'YGT003/26', exporter: 'Yigit', importer: 'TURKMENFRUKT', totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 5, code: 'YGT004/26', exporter: 'Yigit', importer: 'TURKMENFRUKT', totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 6, code: 'YGT005/26', exporter: 'Yigit', importer: 'TransAsia Trade', totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 7, code: 'YGT006/26', exporter: 'Yigit', importer: 'Aranşy - KZ', totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 8, code: 'YGT007/26', exporter: 'Yigit', importer: 'Winta Plus', totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 9, code: 'YGT008/26', exporter: 'Yigit', importer: 'Nur-Alem', totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 10, code: 'YGT009/26', exporter: 'Yigit', importer: 'Aranşy - KZ', totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 11, code: 'YGT010/26', exporter: 'Yigit', importer: 'Hususy telekeçi Tursynbaýew', totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 12, code: 'YGT011/26', exporter: 'Yigit', importer: 'Winta Plus', totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 13, code: null, exporter: null, importer: null, totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
  { no: 14, code: null, exporter: null, importer: null, totalKg: null, totalUsd: null, shippedKg: null, remainingKg: null, receivedUsd: null, remainingUsd: null, deadline: null, daysLeft: null },
];

export const CONTRACTS_TOTAL = {
  totalKg: 45000,
  totalUsd: null as number | null,
  shippedKg: null as number | null,
  remainingKg: 45000,
  receivedUsd: null as number | null,
  remainingUsd: null as number | null,
};

// ─── Sertname töleg yzarlamasy (payment tracking accordion) ────────────────
export interface IPaymentTrackingRow {
  readonly code: string | null;
  readonly exporter: string | null;
  readonly receivedUsd: number | null;
  readonly remainingUsd: number | null;
}

export const PAYMENT_TRACKING: readonly IPaymentTrackingRow[] = CONTRACTS_TABLE.map((c) => ({
  code: c.code,
  exporter: c.exporter,
  receivedUsd: null,
  remainingUsd: null,
}));
