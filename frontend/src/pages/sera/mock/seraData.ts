/**
 * Sera Bütçe — shared mock dataset (2026).
 *
 * Figures transcribed from the source "Sera Bütçe Yönetimi" app so that every
 * cloned screen (Ana Sayfa, Ana Dashboard, Bütçe Dashboard, Pomidor Dükânı,
 * …) shows the same consistent totals. UI-only prototype — no API.
 */

export const SERA_YEAR = 2026;
export const MONTHS_TK = [
  'Ýanwar', 'Fewral', 'Mart', 'Aprel', 'Maý', 'Iýun',
  'Iýul', 'Awgust', 'Sentýabr', 'Oktýabr', 'Noýabr', 'Dekabr',
] as const;
export const MONTHS_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
] as const;
export const MONTHS_SHORT = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
] as const;

// ─── Blocks ──────────────────────────────────────────────────────────────
export interface SeraBlock {
  readonly id: string;
  readonly group: 'Dusak' | 'Kaka' | 'Owadandepe';
  readonly name: string;
  readonly areaGa: number;
  readonly cooled: boolean;
  readonly productionKg: number;
  readonly revenueUsd: number;
  readonly expenseUsd: number;
  readonly profitUsd: number;
}

export const SERA_BLOCKS: readonly SeraBlock[] = [
  { id: 'DUS-A', group: 'Dusak', name: 'Dusak A', areaGa: 10, cooled: true, productionKg: 2787600, revenueUsd: 2574481, expenseUsd: 297761, profitUsd: 2276719 },
  { id: 'DUS-B', group: 'Dusak', name: 'Dusak B', areaGa: 12, cooled: true, productionKg: 2484208, revenueUsd: 2257256, expenseUsd: 1347928, profitUsd: 909328 },
  { id: 'DUS-C', group: 'Dusak', name: 'Dusak C', areaGa: 12, cooled: true, productionKg: 2429213, revenueUsd: 2174055, expenseUsd: 1341138, profitUsd: 832918 },
  { id: 'DUS-1', group: 'Dusak', name: 'Dusak 1', areaGa: 10, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 921782, profitUsd: -921782 },
  { id: 'DUS-2', group: 'Dusak', name: 'Dusak 2', areaGa: 10, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 921782, profitUsd: -921782 },
  { id: 'DUS-3', group: 'Dusak', name: 'Dusak 3', areaGa: 10, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 921782, profitUsd: -921782 },
  { id: 'DUS-4', group: 'Dusak', name: 'Dusak 4', areaGa: 10, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 921782, profitUsd: -921782 },
  { id: 'DUS-5', group: 'Dusak', name: 'Dusak 5', areaGa: 10, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 921782, profitUsd: -921782 },
  { id: 'DUS-6', group: 'Dusak', name: 'Dusak 6', areaGa: 10, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 921782, profitUsd: -921782 },
  { id: 'DUS-7', group: 'Dusak', name: 'Dusak 7', areaGa: 10, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 921782, profitUsd: -921782 },
  { id: 'DUS-8', group: 'Dusak', name: 'Dusak 8', areaGa: 10, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 921782, profitUsd: -921782 },
  { id: 'DUS-9', group: 'Dusak', name: 'Dusak 9', areaGa: 10, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 921782, profitUsd: -921782 },
  { id: 'DUS-10', group: 'Dusak', name: 'Dusak 10', areaGa: 10, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 921782, profitUsd: -921782 },
  { id: 'KAK-D', group: 'Kaka', name: 'Kaka D', areaGa: 20, cooled: true, productionKg: 5247287, revenueUsd: 5144157, expenseUsd: 548537, profitUsd: 4595619 },
  { id: 'KAK-E', group: 'Kaka', name: 'Kaka E', areaGa: 20, cooled: true, productionKg: 4879616, revenueUsd: 4367381, expenseUsd: 507921, profitUsd: 3859460 },
  { id: 'KAK-F', group: 'Kaka', name: 'Kaka F', areaGa: 20, cooled: true, productionKg: 5531721, revenueUsd: 5290577, expenseUsd: 570852, profitUsd: 4719725 },
  { id: 'KAK-G', group: 'Kaka', name: 'Kaka G', areaGa: 20, cooled: true, productionKg: 5617904, revenueUsd: 5427805, expenseUsd: 598262, profitUsd: 4829543 },
  { id: 'KAK-H', group: 'Kaka', name: 'Kaka H', areaGa: 20, cooled: true, productionKg: 5060336, revenueUsd: 4545776, expenseUsd: 507030, profitUsd: 4038746 },
  { id: 'KAK-I', group: 'Kaka', name: 'Kaka I', areaGa: 20, cooled: true, productionKg: 4494323, revenueUsd: 4342244, expenseUsd: 483718, profitUsd: 3858527 },
  { id: 'KAK-J', group: 'Kaka', name: 'Kaka J', areaGa: 20, cooled: true, productionKg: 3602175, revenueUsd: 3361578, expenseUsd: 368455, profitUsd: 2993122 },
  { id: 'KAK-K', group: 'Kaka', name: 'Kaka K', areaGa: 20, cooled: true, productionKg: 4915013, revenueUsd: 4748699, expenseUsd: 526605, profitUsd: 4222093 },
  { id: 'KAK-L', group: 'Kaka', name: 'Kaka L', areaGa: 20, cooled: true, productionKg: 4915013, revenueUsd: 4748699, expenseUsd: 526605, profitUsd: 4222093 },
  { id: 'KAK-N', group: 'Kaka', name: 'Kaka N', areaGa: 20, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 25540, profitUsd: -25540 },
  { id: 'KAK-P', group: 'Kaka', name: 'Kaka P', areaGa: 20, cooled: false, productionKg: 0, revenueUsd: 0, expenseUsd: 25540, profitUsd: -25540 },
  { id: 'KAK-M15', group: 'Kaka', name: 'Kaka M15', areaGa: 15, cooled: true, productionKg: 3368454, revenueUsd: 3103214, expenseUsd: 345345, profitUsd: 2757869 },
  { id: 'KAK-M5', group: 'Kaka', name: 'Kaka M5', areaGa: 5, cooled: true, productionKg: 653544, revenueUsd: 742363, expenseUsd: 76698, profitUsd: 665664 },
  { id: 'OWA-O', group: 'Owadandepe', name: 'Owadandepe O', areaGa: 20, cooled: true, productionKg: 3910243, revenueUsd: 3794772, expenseUsd: 420174, profitUsd: 3374598 },
];

export const SERA_BLOCK_GROUPS = ['Dusak', 'Kaka', 'Owadandepe'] as const;

// ─── Global totals (2026) ───────────────────────────────────────────────
export const SERA_TOTALS = {
  areaGa: 394,
  areaCooledGa: 124,
  areaUncooledGa: 270,
  productionKg: 59896650,
  productionPlanKg: 59896649.5,
  revenueUsd: 56623056,
  revenuePlanUsd: 56623056,
  expenseUsd: 17722851,
  expensePlanUsd: 17735931,
  profitUsd: 38900205,
  profitPlanUsd: 38887125,
  marginPct: 68.7,
  domesticRevenueDtm: 47105484,
  exportGapyKg: 48643991,
  exportGapyPlanKg: 48643991.5,
  domesticKg: 11252658,
  domesticPlanKg: 11252658.1,
  activeTrucks: 8,
} as const;

// ─── Monthly production by channel (kg) ─────────────────────────────────
export interface ChannelRow {
  readonly channel: string;
  readonly months: readonly number[]; // 12 values
  readonly total: number;
}

export const SALES_QTY_BY_CHANNEL: readonly ChannelRow[] = [
  { channel: 'Gazagystan', months: [2875492, 2858798, 3311068, 5607800, 4989272, 3061324, 0, 0, 0, 0, 0, 0], total: 22703753 },
  { channel: 'Russiýa', months: [1437746, 1250724, 2015433, 2560082, 3088597, 1360588, 0, 0, 0, 0, 0, 0], total: 11713170 },
  { channel: 'Gapy Satyş', months: [1437746, 1846307, 1871473, 4022987, 3801350, 1247206, 0, 0, 0, 0, 0, 0], total: 14227069 },
  { channel: 'Içerki Bazar', months: [784225, 812158, 981542, 1662391, 3959739, 3052602, 0, 0, 0, 0, 0, 0], total: 11252658 },
];
export const SALES_QTY_TOTAL: readonly number[] = [6535209, 6767987, 8179516, 13853260, 15838958, 8721720, 0, 0, 0, 0, 0, 0];

// ─── Monthly sales amount by channel (USD / DTM) ────────────────────────
export const SALES_AMT_BY_CHANNEL: readonly ChannelRow[] = [
  { channel: 'Gazagystan', months: [3615356, 5094377, 6392017, 7883445, 4297260, 1860060, 0, 0, 0, 0, 0, 0], total: 29142515 },
  { channel: 'Russiýa', months: [1807678, 2228790, 3890793, 3598964, 2660208, 826693, 0, 0, 0, 0, 0, 0], total: 15013127 },
  { channel: 'Gapy Satyş', months: [1222084, 2492514, 2769780, 4022987, 1710607, 249441, 0, 0, 0, 0, 0, 0], total: 12467414 },
  { channel: 'Içerki Bazar (DTM)', months: [3921126, 4060792, 4907709, 8311956, 19798697, 6105204, 0, 0, 0, 0, 0, 0], total: 47105484 },
];
export const SALES_AMT_USD_TOTAL: readonly number[] = [6645118, 9815682, 13052590, 15505395, 8668076, 2936195, 0, 0, 0, 0, 0, 0];

// ─── Production distribution ────────────────────────────────────────────
export interface DistRow {
  readonly label: string;
  readonly qtyKg: number;
  readonly qtyPct: number;
  readonly revenue: number;
  readonly revenuePct: number | null; // null → show "DTM"
  readonly indent?: boolean;
}
export const PRODUCTION_DIST: readonly DistRow[] = [
  { label: 'Jemi Öndürilen', qtyKg: 59896650, qtyPct: 100, revenue: 56623056, revenuePct: 100 },
  { label: 'Export + Gapy Satyş', qtyKg: 48643991, qtyPct: 81.2, revenue: 56623056, revenuePct: 100 },
  { label: '↳ Gazagystan', qtyKg: 22703753, qtyPct: 37.9, revenue: 29142515, revenuePct: 51.5, indent: true },
  { label: '↳ Russiýa', qtyKg: 11713170, qtyPct: 19.6, revenue: 15013127, revenuePct: 26.5, indent: true },
  { label: '↳ Gapy Satyş', qtyKg: 14227069, qtyPct: 23.8, revenue: 12467414, revenuePct: 22, indent: true },
  { label: 'Içerki Bazar', qtyKg: 11252658, qtyPct: 18.8, revenue: 47105484, revenuePct: null },
];

// ─── Monthly income/expense/profit trend (USD) ──────────────────────────
export const MONTHLY_TREND = {
  revenue: [6645118, 9815682, 13052590, 15505395, 8668076, 2936195, 0, 0, 0, 0, 0, 0],
  expense: [2954321, 2871004, 2966210, 3011845, 2510300, 2409171, 0, 0, 0, 0, 0, 0],
  profit: [3690797, 6944678, 10086380, 12493550, 6157776, 527024, 0, 0, 0, 0, 0, 0],
} as const;

// ─── Planting readiness (Ekişe taýýarlyk) ───────────────────────────────
export const PLANTING_READINESS = [
  { region: 'DUŞAK', pct: 68 },
  { region: 'KAKA', pct: 44 },
  { region: 'OWADANDEPE', pct: 47 },
] as const;

// Convenience aggregates
export const SERA_BLOCKS_BY_GROUP = SERA_BLOCK_GROUPS.map((group) => ({
  group,
  blocks: SERA_BLOCKS.filter((b) => b.group === group),
}));
