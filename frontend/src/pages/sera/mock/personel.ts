/**
 * Personel & Maaşlar — page-specific mock data (2026).
 *
 * The per-block headcount list reuses the shared `SERA_BLOCKS_BY_GROUP`
 * dataset (same block names/areas as the Bütçe Dashboard) — this file only
 * holds the figures unique to this screen: the Dolandyryş (admin-only) row,
 * the per-person monthly cost table, and foreign-worker salaries.
 */

// ─── Dolandyryş (admin) — headcount only, excluded from production math ───
export const ADMIN_BLOCK = {
  name: 'Dolandyryş',
  note: 'Yalnız personel sayısı — üretim/gübre/alan hesaplarına dahil değildir',
} as const;

// ─── Adam Başına Aylık Çykdajy (per-person monthly cost, 12 months) ───────
export interface MonthlyStaffCostRow {
  readonly label: string;
  readonly months: readonly number[];
}

export const MONTHLY_STAFF_COST_ROWS: readonly MonthlyStaffCostRow[] = [
  { label: 'Işgärleri gatnatmak çykdajylary', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { label: 'Işgärleriň saglygy boýunça çykdajylar', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
];

// ─── Daşary Ýurt Işgärleri (foreign workers, annual salary in USD) ────────
export interface ForeignStaffRow {
  readonly country: string;
  readonly annualSalaryUsd: number;
}

export const FOREIGN_STAFF: readonly ForeignStaffRow[] = [
  { country: 'Kazakistan', annualSalaryUsd: 1000 },
  { country: 'Rusya', annualSalaryUsd: 0 },
];

// ─── Maaş Tablosu (Muhasebe) — salary-by-position, grouped by cost code ───
// Mirrors the accounting chart-of-accounts groupings (720/730/750/760/770).
// "İşgär Aylygı" = worker's actual salary, "Resmi Aylygı" = officially
// registered salary (both entered per position by accounting; most are still
// unfilled/zero except the 770 pool, which already carries seed figures).
export type SalaryCurrency = 'DTM' | 'USD';

export interface SalaryPositionRow {
  readonly vazife: string;
  readonly currency: SalaryCurrency;
  readonly isgarAylygy: number;
  readonly resmiAylygy: number;
}

export interface SalaryCategory {
  readonly code: string;
  readonly title: string;
  readonly positions: readonly SalaryPositionRow[];
}

export const SALARY_CATEGORIES: readonly SalaryCategory[] = [
  {
    code: '720',
    title: '720 — Direkt İşçilik',
    positions: [
      { vazife: 'Kömekçi işgär II derejeli (nahar paýlaýan)', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Kömekçi işgär I derejeli (posuda ýuwýan)', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Brigadir', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Topor ýolbaşçysy oglanlaryň', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'I-II-III-IV-nji derejeli önümçilik işçileri', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'I-II-III-IV-nji derejeli işçileri', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Günlikçi işçiler', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
    ],
  },
  {
    code: '730',
    title: '730 — Genel Üretim Giderleri',
    positions: [
      { vazife: 'Önümçilik Müdir', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Önümçilik müdiriniň orunbasary', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Önümçilik Müdiriniň kömekçisi', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Tam süpüriji', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Ambarçy', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Agsamky garawullar', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'I derejeli tehniki işgär (santehnik)', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Agronomlar', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'IT bölümi hünärmeni', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Hasapçy', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Işgärler boýunça hünärmen', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'AR (adam resurslary) b/ça hünärmen', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Tehniki bölümiň mehanigi', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Elektrik', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Kotelny (suw gyzdyryjy)', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'ZG we TH bölümi', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'ZG we TH bölümi lukman', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'KIP awtomatçy', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Tehniki bölümi brigadir', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Nasosçy', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Awtobus sürüji (ýerleşýän adaam sana görä)', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Mehanik (garaž)', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Slesar (garaž)', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
    ],
  },
  {
    code: '750',
    title: '750 —',
    positions: [
      { vazife: 'Hilçiler', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
    ],
  },
  {
    code: '760',
    title: '760 — Pazarlama, Satış ve Dağıtım',
    positions: [
      { vazife: 'Satuw menejeri', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
      { vazife: 'Gapançy we Ýükl/gaplama işgärleri', currency: 'DTM', isgarAylygy: 0, resmiAylygy: 0 },
    ],
  },
  {
    code: '770',
    title: '770 — Genel Yönetim (Havuz)',
    positions: [
      { vazife: 'Üpjünçilik b/ç Hünärmen', currency: 'DTM', isgarAylygy: 500, resmiAylygy: 500 },
      { vazife: 'Dolandyryş hünärmeni', currency: 'DTM', isgarAylygy: 550, resmiAylygy: 550 },
      { vazife: 'Satuw Hünärmeni', currency: 'DTM', isgarAylygy: 520, resmiAylygy: 520 },
      { vazife: 'Eksport boýunça Hünärmen', currency: 'DTM', isgarAylygy: 540, resmiAylygy: 540 },
      { vazife: 'Gözleg we Seljeriş boýunça Hünärmen', currency: 'DTM', isgarAylygy: 510, resmiAylygy: 510 },
    ],
  },
];
