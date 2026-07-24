/**
 * Sera İzleme (Sera Gözegçiligi) — greenhouse monitoring mock data.
 *
 * Figures transcribed from the source "Sera İzleme" screen: per-block
 * planting-readiness percentages (Ekiş Taýýarlygy) grouped by Dusak / Kaka /
 * Owadandepe, plus the sub-block progress breakdown shown on the Dusak A/B/C
 * comparison cards. Block names/ids reused from `seraData.SERA_BLOCKS`.
 */
import type { SeraBlock } from './seraData';

// ─── Per-block planting-readiness % (chip badges) ───────────────────────
// undefined → no date entered yet ("Sene girizilmän"), chip shows no % badge.
export const BLOCK_READINESS: Readonly<Record<string, number | undefined>> = {
  'DUS-A': 57, 'DUS-B': 67, 'DUS-C': 79,
  'DUS-1': undefined, 'DUS-2': undefined, 'DUS-3': undefined, 'DUS-4': undefined,
  'DUS-5': undefined, 'DUS-6': undefined, 'DUS-7': undefined, 'DUS-8': undefined,
  'DUS-9': undefined, 'DUS-10': undefined,
  'KAK-D': 31, 'KAK-E': 70, 'KAK-F': 66, 'KAK-G': 26, 'KAK-H': 51,
  'KAK-I': 46, 'KAK-J': 42, 'KAK-K': 51, 'KAK-L': 43, 'KAK-N': undefined,
  'KAK-P': 11, 'KAK-M15': 49, 'KAK-M5': undefined,
  'OWA-O': 47,
};

// ─── Group-level overview (Umumy Duşak / Kaka / Owadandepe) ─────────────
export interface GroupOverview {
  readonly group: SeraBlock['group'];
  readonly label: string; // as shown on the group chip
  readonly pct: number;
  readonly tint: string;
  readonly border: string;
}

export const GROUP_OVERVIEW: readonly GroupOverview[] = [
  { group: 'Dusak', label: 'Umumy Duşak', pct: 68, tint: '#eafbf1', border: '#bfe9d3' },
  { group: 'Kaka', label: 'Kaka', pct: 44, tint: '#eef3ff', border: '#c9d9fb' },
  { group: 'Owadandepe', label: 'Owadandepe', pct: 47, tint: '#fdf8e3', border: '#f1e3ad' },
];

// ─── Per-block sub-block progress cards (Dusak A / B / C) ───────────────
export interface SubBlockProgress {
  readonly code: string;
  readonly pct: number;
}

export interface BlockProgressCard {
  readonly id: string;
  readonly name: string;
  readonly pct: number;
  readonly dateRange: string | null; // null → "Sene girizilmän"
  readonly blockDateRange?: string; // extra "Blok: ..." footer line (Dusak A only)
  readonly subBlocks: readonly SubBlockProgress[];
  readonly jobsDone: number;
  readonly jobsTotal: number;
  readonly season: string;
}

export const IZLEME_BLOCK_CARDS: readonly BlockProgressCard[] = [
  {
    id: 'DUS-A', name: 'Dusak A', pct: 57,
    dateRange: '01.01 → 12.31.2026',
    blockDateRange: '01.01.2026 — 31.12.2026',
    subBlocks: [
      { code: 'A1', pct: 56 }, { code: 'A2', pct: 61 },
      { code: 'A3', pct: 56 }, { code: 'A4', pct: 56 },
    ],
    jobsDone: 41, jobsTotal: 72, season: '2025-2026',
  },
  {
    id: 'DUS-B', name: 'Dusak B', pct: 67,
    dateRange: null,
    subBlocks: [
      { code: 'B1', pct: 56 }, { code: 'B2', pct: 72 }, { code: 'B3', pct: 72 },
      { code: 'B4', pct: 72 }, { code: 'B5', pct: 72 }, { code: 'B6', pct: 72 },
      { code: 'B7', pct: 61 }, { code: 'B8', pct: 61 },
    ],
    jobsDone: 97, jobsTotal: 144, season: '2025-2026',
  },
  {
    id: 'DUS-C', name: 'Dusak C', pct: 79,
    dateRange: null,
    subBlocks: [
      { code: 'C1', pct: 72 }, { code: 'C2', pct: 83 }, { code: 'C3', pct: 78 },
      { code: 'C4', pct: 78 }, { code: 'C5', pct: 78 }, { code: 'C6', pct: 78 },
      { code: 'C7', pct: 83 }, { code: 'C8', pct: 78 },
    ],
    jobsDone: 113, jobsTotal: 144, season: '2025-2026',
  },
];

export const IZLEME_SEASONS = ['2024-2025', '2025-2026', '2026-2027'] as const;

export const IZLEME_DEFAULT_SELECTED: readonly string[] = ['DUS-A', 'DUS-B', 'DUS-C'];

// ─── Sera Kartasy (Sera Haritası) — health-status legend + row plan ─────
export interface HealthLegendItem {
  readonly label: string;
  readonly color: string;
}

export const HEALTH_LEGEND: readonly HealthLegendItem[] = [
  { label: 'Sagdyn', color: '#86efac' },
  { label: 'Ýeňil kesel', color: '#fde047' },
  { label: 'Orta kesel', color: '#fb923c' },
  { label: 'Agyr', color: '#f87171' },
  { label: 'Sowuk (<12°C)', color: '#93c5fd' },
  { label: 'Yssy (>35°C)', color: '#fed7aa' },
  { label: 'Maglumat ýok', color: '#e5e7eb' },
];

/** Row plan grid size ("Sıra Planı") for the map tab. Only Dusak A confirmed by source — reused for every block. */
export const MAP_ROW_COUNT = 49;

// ─── Ýazgylar (Kayıtlar) — greenhouse monitoring log rows ────────────────
export interface IzlemeRecord {
  readonly id: number;
  readonly seraNo: number;
  readonly rowCode: string;
  readonly date: string;
  readonly tempC: number;
  readonly humidityPct: number;
  readonly sunHours: number;
  readonly isHealthy: boolean;
  readonly notes: string;
}

export const IZLEME_RECORDS: readonly IzlemeRecord[] = [
  { id: 1, seraNo: 3, rowCode: 'A08', date: '2026-06-29', tempC: 25, humidityPct: 65, sunHours: 8.5, isHealthy: true, notes: 'dsds' },
  { id: 2, seraNo: 3, rowCode: 'A01', date: '2026-06-29', tempC: 30, humidityPct: 70, sunHours: 8.5, isHealthy: true, notes: '' },
  { id: 3, seraNo: 10, rowCode: 'A01', date: '2026-06-26', tempC: 26, humidityPct: 65, sunHours: 9, isHealthy: true, notes: 'sdssdsdsds' },
];

// ─── Kesel (Hastalık) dashboard — currently empty (no disease records) ──
export const DISEASE_BLOCK_CATEGORIES: readonly string[] = [
  'Dusak C', 'Dusak 3', 'Dusak 6', 'Dusak 9', 'Kaka E', 'Kaka H', 'Kaka K', 'Owadandepe O',
];
export const DISEASE_BLOCK_COUNTS: readonly number[] = DISEASE_BLOCK_CATEGORIES.map(() => 0);

export const DISEASE_TREND_DATES: readonly string[] = ['06-26'];
export const DISEASE_TREND_COUNTS: readonly number[] = [0];

export const SEVERITY_DIST = { light: 0, medium: 0, severe: 0 } as const;

// ─── Howa & Yşyk (İklim & Işık) — 90-day trend + per-block averages ─────
export const CLIMATE_TREND_DATES: readonly string[] = ['06-26'];
export const CLIMATE_TREND_TEMP: readonly number[] = [0];
export const CLIMATE_TREND_HUMIDITY: readonly number[] = [0];
export const CLIMATE_TREND_SUN_HOURS: readonly number[] = [0];
export const CLIMATE_TREND_JOULE_WANTED: readonly number[] = [0];
export const CLIMATE_TREND_JOULE_ACTUAL: readonly number[] = [0];
