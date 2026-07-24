/**
 * Esasy Dashboard (Ana Dashboard) — page-specific mock figures.
 *
 * `seraData.ts` already carries the shared totals/channel splits, but the
 * source dashboard's monthly report table shows decimal-precise Önümçilik /
 * Eksport+Gapy / Içerki tonnages that don't line up exactly with the rounded
 * integer channel arrays there. Transcribed straight from the reference DOM
 * snapshot so the table matches it exactly. UI-only prototype — no API.
 */

// ─── Monthly report table (t), Ocak → Haziran populated, rest 0 ─────────
export const PRODUCTION_MONTHLY: readonly number[] = [
  6535209.3, 6767986, 8179515.8, 13853259.7, 15838957.8, 8721720,
  0, 0, 0, 0, 0, 0,
];

export const EXPORT_GAPY_MONTHLY: readonly number[] = [
  5750984.2, 5955828.5, 7197973.9, 12190868.5, 11879218.4, 5669118,
  0, 0, 0, 0, 0, 0,
];

export const DOMESTIC_MONTHLY: readonly number[] = [
  784225.1, 812158.4, 981541.9, 1662391.2, 3959739.5, 3052602,
  0, 0, 0, 0, 0, 0,
];
