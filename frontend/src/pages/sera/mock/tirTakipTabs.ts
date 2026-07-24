/**
 * Sera Bütçe — Maşyn Yzarlama (Tır Takip) sub-tab mock data.
 *
 * Covers the 8 non-Önümçilik tabs (Gaplama, Tırlar, Export Raporu, Hasabat,
 * Gümrük Ewraklary, Kwota Takibi, Yurtdışı Sertnamaları, Datalar). Figures
 * are transcribed verbatim from each tab's own reference screenshot/DOM
 * snapshot (sera-ref/31..38) — totals are copied as-shown and intentionally
 * NOT cross-footed against each other (the source app itself doesn't
 * reconcile them, e.g. Export Raporu's "Hasabat gelmedi: 8" vs the empty
 * "Hasabat GELMEDIK" list). UI-only prototype — no API.
 */
import { SERA_BLOCKS } from './seraData';

// ─── Gaplama (packaging) ────────────────────────────────────────────────
/** Same "today + tomorrow" shape as Önümçilik's Dusak A; every other block
 * is 0 this week (packaging hasn't reached it yet). */
export const GAPLAMA_WEEKLY_KG_BY_BLOCK: Record<string, number[]> = Object.fromEntries(
  SERA_BLOCKS.map((b) => [b.id, [0, 0, 0, 0, 0, 0, 0]]),
);
GAPLAMA_WEEKLY_KG_BY_BLOCK['DUS-A'] = [15000, 16000, 0, 0, 0, 0, 0];

/** kg of this block's packaging already loaded onto opened Gaplama trucks
 * this week — feeds the "Blok Bakiyesi — Haftalık Özet" table. */
export const GAPLAMA_TRUCK_USED_KG_BY_BLOCK: Record<string, number> = { 'DUS-A': 15000 };

export interface GaplamaTruck {
  readonly code: string;
  readonly blocksLabel: string;
  readonly kg: number;
  readonly status: string;
  readonly openedAt: string;
}
export const GAPLAMA_OPENED_TRUCKS: readonly GaplamaTruck[] = [
  { code: '23JL003/26', blocksLabel: 'Dusak C (16.000 kg) + Kaka D (4.000 kg)', kg: 20000, status: 'Açyldy', openedAt: '23.07.2026 09:36' },
  { code: '23JL002/26', blocksLabel: 'Dusak B (12.000 kg) + Dusak C (8.000 kg)', kg: 20000, status: 'Açyldy', openedAt: '23.07.2026 09:36' },
  { code: '23JL001/26', blocksLabel: 'Dusak A (15.000 kg) + Dusak B (5.000 kg)', kg: 20000, status: 'Açyldy', openedAt: '23.07.2026 09:36' },
];

// ─── Tırlar (shared truck header, used by Tırlar + Gümrük Ewraklary) ────
export type TirTruckCategory = 'Gaplama' | 'Export Bölüm';
export interface TirTruck {
  readonly code: string;
  readonly route: string;
  readonly status: string;
  readonly category: TirTruckCategory;
}
export const TIR_TRUCKS: readonly TirTruck[] = [
  { code: '23JL001/26', route: 'Dusak A + Dusak B', status: 'Açyldy', category: 'Gaplama' },
  { code: '23JL002/26', route: 'Dusak B + Dusak C', status: 'Açyldy', category: 'Gaplama' },
  { code: '23JL003/26', route: 'Dusak C + Kaka D', status: 'Açyldy', category: 'Gaplama' },
  { code: '—', route: '—', status: 'Açyldy', category: 'Export Bölüm' },
  { code: '—', route: '—', status: 'Açyldy', category: 'Export Bölüm' },
  { code: '—', route: '—', status: 'Açyldy', category: 'Export Bölüm' },
  { code: '—', route: '—', status: 'Açyldy', category: 'Export Bölüm' },
  { code: '—', route: '—', status: 'Açyldy', category: 'Export Bölüm' },
];

export interface TirFirmSplit { readonly name: string; readonly kg: number; }
/** Index-aligned with TIR_TRUCKS — null = no firm assigned yet ("+ Firma goş"). */
export const TIR_TRUCK_FIRMS: readonly (readonly TirFirmSplit[] | null)[] = [
  [{ name: 'Yigit', kg: 18000 }],
  null,
  null,
  [{ name: 'Hemsaya', kg: 18000 }],
  [{ name: 'Yigit', kg: 17000 }],
  null,
  null,
  null,
];

function rep(value: string, n = 8): string[] {
  return Array.from({ length: n }, () => value);
}

export interface TirFieldRow { readonly label: string; readonly values: readonly string[]; }
export interface TirSection { readonly title: string; readonly rows: readonly TirFieldRow[]; }

export const TIR_SECTIONS: readonly TirSection[] = [
  {
    title: 'GENEL BİLGİLER',
    rows: [
      {
        label: 'Kg / Açylan wagty',
        values: [
          '20.000 kg · 23.07.2026 09:36', '20.000 kg · 23.07.2026 09:36', '20.000 kg · 23.07.2026 09:36',
          '20.000 kg · 23.07.2026 09:37', '20.000 kg · 23.07.2026 09:37', '20.000 kg · 23.07.2026 09:37',
          '20.000 kg · 23.07.2026 09:37', '20.000 kg · 23.07.2026 09:41',
        ],
      },
      { label: 'Ýüklenjek ýeri', values: ['AB', 'BC', 'C/D', '—', '—', '—', '—', '—'] },
      { label: 'Ýygym ýagdaýy', values: rep('—') },
    ],
  },
  {
    title: 'EXPORT KODY',
    rows: [{ label: 'Export Kody', values: ['23JL001/26', '23JL002/26', '23JL003/26', '—', '—', '—', '—', '—'] }],
  },
  {
    title: 'YÜK & GÜMRÜK MAGLUMATLARY',
    rows: [
      { label: 'Resminamalar', values: ['—', '—', '—', 'Dowam edýär', 'Dowam edýär', '—', '—', 'Dowam edýär'] },
      { label: 'Eksport ýurdy', values: ['—', '—', '—', '—', '—', '—', '—', 'Gazagystan'] },
      { label: 'Müşderi ady', values: ['—', '—', '—', '—', '—', '—', '—', 'Begjan'] },
      { label: 'Müşderi tel.', values: ['—', '—', '—', '—', '—', '—', '—', '+99363719364'] },
      { label: 'Şäheri', values: ['—', '—', '—', '—', '—', '—', '—', 'Astana'] },
      { label: 'Import Firma', values: ['—', '—', '—', '—', 'Aranşy - KZ', '—', '—', 'Aranşy - KZ'] },
      { label: 'Sertnama No', values: ['YGT006/26', '—', '—', '—', 'YGT006/26', '—', '—', '—'] },
      { label: 'Invoice Num', values: ['INV-001/26', '—', '—', 'INV-002/26', 'INV-002/26', '—', '—', '—'] },
    ],
  },
  {
    title: 'TRANSPORT MAGLUMATLARY',
    rows: [
      { label: 'Sürüji F.A.', values: rep('—') },
      { label: 'Sürüji tel.', values: rep('—') },
      { label: 'Plaka', values: rep('—') },
      { label: 'Transport jogapkar', values: rep('—') },
    ],
  },
  {
    title: 'ÝÜKLEME ZAMANLARY',
    rows: [
      { label: 'Gümrük edilen wagty', values: rep('—') },
      { label: 'Ýüklemäniň Başlan wagty', values: rep('—') },
      { label: 'Ýüklemäniň gutaran wagty', values: rep('—') },
      { label: 'Takmynan ýol güni', values: rep('—') },
    ],
  },
  {
    title: 'ÝOLDA / SERHET',
    rows: [
      { label: 'TM çykan nokady', values: rep('—') },
      { label: 'TM çykan wagty', values: rep('—') },
      { label: 'Barmaly ýurduna giren', values: rep('—') },
      { label: 'Peregruz ýagdaýy', values: rep('—') },
      { label: 'Peregruz wagty', values: rep('—') },
      { label: 'Barmaly nokada gelen', values: rep('—') },
    ],
  },
  {
    title: 'SATYŞ & HASABAT',
    rows: [
      { label: 'Arassa agramy (h)', values: rep('—') },
      { label: 'Pomidor görnüşi', values: rep('—') },
      { label: 'Ýygylan senesi', values: rep('—') },
      { label: 'Satylyp başlan', values: rep('—') },
      { label: 'Satylyp gutaran', values: rep('—') },
      { label: 'Hasabat gelen', values: rep('—') },
    ],
  },
  {
    title: 'TAPGYRLAR',
    rows: [
      { label: 'Ýüklemä Başlandy', values: rep('Okat') },
      { label: 'Ýükleme Gutardy', values: rep('Okat') },
      { label: 'Gümrükden Çykdy', values: rep('Okat') },
      { label: 'Barmaly Ýerine Geldi', values: rep('Okat') },
    ],
  },
];

// ─── Gümrük Ewraklary ────────────────────────────────────────────────────
export const GUMRUK_SECTIONS: readonly TirSection[] = [
  {
    title: 'Deklarasiýa (Gümrük Beýannamasy)',
    rows: ['Deklarasiýa belgisi', 'Eksport eden firma', 'Alyjy (Importer)', 'Deklarant/Wekil', 'Gümrük bahasy', 'ÝOHS (%)', 'Barmaly ýurdy']
      .map((label) => ({ label, values: rep('—') })),
  },
  {
    title: 'CMR (Halkara Daşalýan Ýanhat)',
    rows: ['CMR belgisi', 'Sürüjiniň ady', 'Brutto (kg)', 'Netto (kg)'].map((label) => ({ label, values: rep('—') })),
  },
  {
    title: 'Inwoýs (Hasap-faktura)',
    rows: ['Inwoýs belgisi (№)', 'Inwoýs senesi', 'Kontrakt belgisi', 'Kontrakt senesi'].map((label) => ({ label, values: rep('—') })),
  },
  {
    title: '— Satyjy —',
    rows: ['Satyjy (ady)', 'Salgysy', 'Bank rekwizitleri', 'SWIFT'].map((label) => ({ label, values: rep('—') })),
  },
  {
    title: '— Alyjy —',
    rows: ['Alyjy (ady)', 'Salgysy', 'INN / OKPO', 'Telefon', 'Bank rekwizitleri', 'SWIFT'].map((label) => ({ label, values: rep('—') })),
  },
  {
    title: '— Haryt we Şertler —',
    rows: ['Harydyň çykyş ýurdy', 'Eltip beriş şertleri (FCA/...)', 'Birim baha (USD/kg)', 'Jemi tutar (USD)', 'Paletleme belligi']
      .map((label) => ({ label, values: rep('—') })),
  },
  {
    title: 'Sertifikat (CT-1 — Köken Belgesi)',
    rows: ['Sertifikat belgisi', 'TM belgisi'].map((label) => ({ label, values: rep('—') })),
  },
  {
    title: 'Fitosanitar Sertifikat',
    rows: ['Sertifikat belgisi', 'Berlen senesi', 'Hereket möhleti'].map((label) => ({ label, values: rep('—') })),
  },
];

// ─── Export Raporu ───────────────────────────────────────────────────────
export interface ExportRaporuStat { readonly value: number; readonly label: string; }
export const EXPORT_RAPORU_STATS: readonly ExportRaporuStat[] = [
  { value: 8, label: 'Jemi Tır' },
  { value: 0, label: 'Ýükleme başlandy' },
  { value: 0, label: 'Dowam edýär' },
  { value: 0, label: 'TM serh. geçdi' },
  { value: 0, label: 'Aktarma bolan' },
  { value: 0, label: 'Tamamlanan' },
  { value: 0, label: 'Hasabat gelen' },
  { value: 8, label: 'Hasabat gelmedi' },
];

export interface ExportRaporuCountry {
  readonly name: string;
  readonly truckCount: number;
  readonly stages: readonly { readonly label: string; readonly value: number }[];
  readonly reportGelen: number;
  readonly reportGelmedi: number;
}
const EXPORT_RAPORU_STAGE_LABELS = ['Ýükleme başlandy', 'Dowam edýär', 'TM serhedini geçdi', 'Aktarma bolan', 'Tamamlanan'];
export const EXPORT_RAPORU_COUNTRIES: readonly ExportRaporuCountry[] = [
  { name: 'Näbelli', truckCount: 7, stages: EXPORT_RAPORU_STAGE_LABELS.map((label) => ({ label, value: 0 })), reportGelen: 0, reportGelmedi: 7 },
  { name: 'Gazagystan', truckCount: 1, stages: EXPORT_RAPORU_STAGE_LABELS.map((label) => ({ label, value: 0 })), reportGelen: 0, reportGelmedi: 1 },
];
// Verbatim from source — contradicts the "Hasabat gelmedi: 8" tally above; reproduced as-is.
export const EXPORT_RAPORU_GELEN_COUNT = 0;
export const EXPORT_RAPORU_GELMEDIK_COUNT = 0;

// ─── Hasabat ──────────────────────────────────────────────────────────────
export const HASABAT_STATS = {
  jemiTir: 8, jemiKg: '153K', jemiKgSub: 'eksport firmalardan', ortacaKg: '19K', acykTirlar: 8, tamamlanan: 0,
} as const;
export const HASABAT_MONTHLY = { months: ['07/26'], kg: [153000], tir: [8] } as const;
export const HASABAT_COUNTRIES_PIE: readonly { readonly name: string; readonly pct: number }[] = [
  { name: 'Näbelli', pct: 87 }, { name: 'Gazagystan', pct: 13 },
];
export const HASABAT_FIRMS_PIE: readonly { readonly name: string; readonly pct: number }[] = [
  { name: 'Yigit', pct: 23 }, { name: 'Hemsaya', pct: 12 },
];
export const HASABAT_CUSTOMERS_BAR: readonly { readonly name: string; readonly kg: number }[] = [
  { name: 'Näbelli', kg: 133000 }, { name: 'Begjan', kg: 20000 },
];
export const HASABAT_BLOCKS_BAR: readonly { readonly name: string; readonly kg: number }[] = [
  { name: 'Näbelli', kg: 87000 }, { name: 'Dusak B', kg: 20000 }, { name: 'Dusak C', kg: 20000 }, { name: 'Dusak A', kg: 15000 },
];
export interface HasabatDetailRow { readonly name: string; readonly count: number; readonly kg: number; readonly pct: number; }
export const HASABAT_COUNTRIES_TABLE: readonly HasabatDetailRow[] = [
  { name: 'Näbelli', count: 7, kg: 133000, pct: 87 }, { name: 'Gazagystan', count: 1, kg: 20000, pct: 13 },
];
export const HASABAT_FIRMS_TABLE: readonly HasabatDetailRow[] = [
  { name: 'Yigit', count: 2, kg: 35000, pct: 23 }, { name: 'Hemsaya', count: 1, kg: 18000, pct: 12 },
];
export const HASABAT_CUSTOMERS_TABLE: readonly HasabatDetailRow[] = [
  { name: 'Näbelli', count: 7, kg: 133000, pct: 87 }, { name: 'Begjan', count: 1, kg: 20000, pct: 13 },
];
export const HASABAT_VARIETY_TABLE: readonly HasabatDetailRow[] = [
  { name: 'Näbelli', count: 8, kg: 153000, pct: 100 },
];

// ─── Kwota Takibi ─────────────────────────────────────────────────────────
export const KWOTA_FIRMS = ['Yigit', 'Hemsaya', 'Datly Miwe', 'Akbulut'] as const;
export const KWOTA_KPIS = { cykan: 80000, islenen: 53000, astatok: 27000, masynSany: 3 } as const;
export const KWOTA_FIRM_CARDS: readonly { readonly name: string; readonly islenen: number; readonly astatok: number }[] = [
  { name: 'Yigit', islenen: 35000, astatok: -15000 },
  { name: 'Hemsaya', islenen: 18000, astatok: 2000 },
  { name: 'Datly Miwe', islenen: 0, astatok: 20000 },
  { name: 'Akbulut', islenen: 0, astatok: 20000 },
];
export interface KwotaCykanRow { readonly date: string | null; readonly perFirm: readonly number[]; }
export const KWOTA_CYKAN_ROWS: readonly KwotaCykanRow[] = [
  { date: '01.05.2026', perFirm: [20000, 20000, 20000, 20000] },
  { date: null, perFirm: [0, 0, 0, 0] },
  { date: null, perFirm: [0, 0, 0, 0] },
  { date: null, perFirm: [0, 0, 0, 0] },
  { date: null, perFirm: [0, 0, 0, 0] },
  { date: null, perFirm: [0, 0, 0, 0] },
  { date: null, perFirm: [0, 0, 0, 0] },
];
export interface KwotaIslenenRow {
  readonly date: string;
  readonly exportCode: string | null;
  readonly perFirm: readonly (number | null)[];
  readonly total: number;
}
export const KWOTA_ISLENEN_ROWS: readonly KwotaIslenenRow[] = [
  { date: '23.07.2026', exportCode: '23JL001/26', perFirm: [18000, null, null, null], total: 18000 },
  { date: '23.07.2026', exportCode: null, perFirm: [null, 18000, null, null], total: 18000 },
  { date: '23.07.2026', exportCode: null, perFirm: [17000, null, null, null], total: 17000 },
];
export const KWOTA_ISLENEN_TOTALS: readonly number[] = [35000, 18000, 0, 0];
export const KWOTA_MASYN_SANY: readonly number[] = [2, 1, 0, 0];

// ─── Yurtdışı Sertnamaları ────────────────────────────────────────────────
export interface SertnamaCompanyChip { readonly name: string; readonly count: number; }
export const SERTNAMA_COMPANIES: readonly SertnamaCompanyChip[] = [
  { name: 'Yigit', count: 11 }, { name: 'Hemsaya', count: 0 }, { name: 'Akbulut', count: 0 },
  { name: 'Tel:Dovranov E', count: 0 }, { name: 'Datly Miwe', count: 0 }, { name: 'Miweli Atyz', count: 0 },
  { name: 'Gök Bulut', count: 1 }, { name: 'Tel.Dovranov J', count: 0 }, { name: 'Tel.Hemidov P', count: 0 },
  { name: 'Tel.Hemidov Ç', count: 0 }, { name: 'Tel.Amangeldiyew G.', count: 0 }, { name: 'Tel.Jumamyradov G.', count: 0 },
  { name: 'Yumak', count: 0 }, { name: 'Işgär', count: 0 }, { name: 'Ygtybarly Enjam', count: 0 },
];
export const SERTNAMA_TOTAL = 14;
export const SERTNAMA_ZDELKA = { total: 14, pasport: 12, bezpasport: 2 } as const;

export interface SertnamaRow {
  readonly no: number;
  readonly exportFirm: string;
  readonly importFirm: string;
  readonly code: string | null;
  readonly zdelka: 'Pasport' | 'Bezpasport';
  readonly country: string | null;
  readonly kg: number | null;
  readonly unitPrice: number | null;
  readonly totalPrice: number | null;
  readonly usedKg: number | null;
  readonly remainingKg: number | null;
  readonly remainingTotal: number | null;
  readonly truckPlate: string | null;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly status: string;
}
const SERTNAMA_BLANK = {
  country: null, kg: null, unitPrice: null, totalPrice: null, usedKg: null,
  remainingKg: null, remainingTotal: null, truckPlate: null, issuedAt: null, expiresAt: null,
} as const;
export const SERTNAMA_ROWS: readonly SertnamaRow[] = [
  { no: 1, exportFirm: 'Yigit', importFirm: 'Nur-Alem', code: 'YGT001/26', zdelka: 'Pasport', country: 'Gazagystan', kg: 36000, unitPrice: 0.87, totalPrice: 31320, usedKg: null, remainingKg: 36000, remainingTotal: 31320, truckPlate: null, issuedAt: '01.07.2026', expiresAt: '05.07.2026', status: 'Pasport · Möhleti geçdi' },
  { no: 2, exportFirm: 'Gök Bulut', importFirm: 'Nur-Alem', code: 'GB002/26', zdelka: 'Pasport', country: 'Gazagystan', kg: 9000, unitPrice: 0.87, totalPrice: 7830, usedKg: null, remainingKg: 9000, remainingTotal: 7830, truckPlate: null, issuedAt: null, expiresAt: null, status: 'Pasport' },
  { no: 3, exportFirm: 'Yigit', importFirm: 'ŞAHFRUKT', code: 'YGT002/26', zdelka: 'Pasport', ...SERTNAMA_BLANK, status: 'Pasport' },
  { no: 4, exportFirm: 'Yigit', importFirm: 'TURKMENFRUKT', code: 'YGT003/26', zdelka: 'Pasport', ...SERTNAMA_BLANK, status: 'Pasport' },
  { no: 5, exportFirm: 'Yigit', importFirm: 'TURKMENFRUKT', code: 'YGT004/26', zdelka: 'Pasport', ...SERTNAMA_BLANK, status: 'Pasport' },
  { no: 6, exportFirm: 'Yigit', importFirm: 'TransAsia Trade', code: 'YGT005/26', zdelka: 'Pasport', ...SERTNAMA_BLANK, status: 'Pasport' },
  { no: 7, exportFirm: 'Yigit', importFirm: 'Aranşy - KZ', code: 'YGT006/26', zdelka: 'Pasport', ...SERTNAMA_BLANK, usedKg: 35000, status: 'Pasport' },
  { no: 8, exportFirm: 'Yigit', importFirm: 'Winta Plus', code: 'YGT007/26', zdelka: 'Pasport', ...SERTNAMA_BLANK, status: 'Pasport' },
  { no: 9, exportFirm: 'Yigit', importFirm: 'Nur-Alem', code: 'YGT008/26', zdelka: 'Bezpasport', ...SERTNAMA_BLANK, status: 'Bezpasport' },
  { no: 10, exportFirm: 'Yigit', importFirm: 'Aranşy - KZ', code: 'YGT009/26', zdelka: 'Bezpasport', ...SERTNAMA_BLANK, status: 'Bezpasport' },
  { no: 11, exportFirm: 'Yigit', importFirm: 'Hususy telekeçi Tursynbaýew', code: 'YGT010/26', zdelka: 'Pasport', ...SERTNAMA_BLANK, status: 'Pasport' },
  { no: 12, exportFirm: 'Yigit', importFirm: 'Winta Plus', code: 'YGT011/26', zdelka: 'Pasport', ...SERTNAMA_BLANK, status: 'Pasport' },
  { no: 13, exportFirm: '— saýlaň —', importFirm: '— saýlaň —', code: null, zdelka: 'Pasport', ...SERTNAMA_BLANK, status: 'Pasport' },
  { no: 14, exportFirm: '— saýlaň —', importFirm: '— saýlaň —', code: null, zdelka: 'Pasport', ...SERTNAMA_BLANK, status: 'Pasport' },
];

// ─── Datalar ──────────────────────────────────────────────────────────────
export interface DatalarTag { readonly text: string; readonly color: string; }
export interface DatalarRow {
  readonly no: number;
  readonly resminamalar: DatalarTag | null;
  readonly exportFirm: string;
  readonly shortCode: string;
  readonly kontroktNom: string;
  readonly invoiceNom: string;
  readonly eksportYurdy: DatalarTag | null;
  readonly musderiAdy: string | null;
  readonly musderiTel: string | null;
  readonly tmCykanNokady: DatalarTag | null;
  readonly saheri: string | null;
  readonly yygymYagdayy: DatalarTag | null;
  readonly peregruzYagdayy: DatalarTag | null;
  readonly importFirma: string | null;
  readonly pomidorGornusi: string | null;
  readonly plaka: string | null;
}
const DATALAR_BLANK = {
  resminamalar: null, eksportYurdy: null, musderiAdy: null, musderiTel: null, tmCykanNokady: null,
  saheri: null, yygymYagdayy: null, peregruzYagdayy: null, importFirma: null, pomidorGornusi: null, plaka: null,
} as const;
export const DATALAR_ROWS: readonly DatalarRow[] = [
  {
    no: 1, exportFirm: 'Yigit', shortCode: 'YGT', kontroktNom: '001', invoiceNom: '1',
    resminamalar: { text: 'Dowam edyar', color: '#0cd41a' }, eksportYurdy: { text: 'Gazagystan', color: '#c4ba45' },
    musderiAdy: 'Begjan', musderiTel: '+99363719364', tmCykanNokady: { text: 'Farap', color: '#e67aa0' },
    saheri: 'Astana', yygymYagdayy: { text: 'Dowam edyar', color: '#e10e63' }, peregruzYagdayy: { text: 'Yok', color: '#98a0ae' },
    importFirma: null, pomidorGornusi: null, plaka: '5241/5631',
  },
  {
    no: 2, exportFirm: 'Hemsaya', shortCode: 'HMS', kontroktNom: '001', invoiceNom: '2',
    resminamalar: { text: 'Tayyar', color: '#496fc1' }, eksportYurdy: { text: 'Eyran', color: '#e5e7eb' },
    musderiAdy: 'Berik', musderiTel: '+99363719364', tmCykanNokady: { text: 'Bektas', color: '#5b83d2' },
    saheri: 'Almata', yygymYagdayy: { text: 'Tayyar', color: '#13f00f' }, peregruzYagdayy: { text: 'Hawa', color: '#f94848' },
    importFirma: 'ŞAHFRUKT', pomidorGornusi: 'Wetka', plaka: '6235/4587',
  },
  {
    no: 3, exportFirm: 'Akbulut', shortCode: 'AB', kontroktNom: '001', invoiceNom: '3',
    ...DATALAR_BLANK, eksportYurdy: { text: 'Rossiya', color: '#e25950' }, musderiAdy: 'Eldar', musderiTel: '+99363719364',
    tmCykanNokady: { text: 'Garabogaz', color: '#e5e7eb' }, saheri: 'Moskwa', yygymYagdayy: { text: 'Ok', color: '#b3b7b4' },
    importFirma: 'TURKMENFRUKT', plaka: '6255/6991',
  },
  {
    no: 4, exportFirm: 'Tel:Dovranov E', shortCode: 'TDE', kontroktNom: '001', invoiceNom: '4',
    ...DATALAR_BLANK, eksportYurdy: { text: 'Gyrgysyztan', color: '#7393d3' }, tmCykanNokady: { text: 'Kerki', color: '#e5e7eb' },
    importFirma: 'TransAsia Trade',
  },
  { no: 5, exportFirm: 'Datly Miwe', shortCode: 'DM', kontroktNom: '001', invoiceNom: '5', ...DATALAR_BLANK, importFirma: 'Hususy telekeçi Tursynbaýew' },
  { no: 6, exportFirm: 'Miweli Atyz', shortCode: 'MA', kontroktNom: '001', invoiceNom: '6', ...DATALAR_BLANK, importFirma: 'Aranşy - KZ' },
  { no: 7, exportFirm: 'Gök Bulut', shortCode: 'GB', kontroktNom: '002', invoiceNom: '7', ...DATALAR_BLANK, importFirma: 'Glavryba' },
  { no: 8, exportFirm: 'Tel.Dovranov J', shortCode: 'TDJ', kontroktNom: '001', invoiceNom: '8', ...DATALAR_BLANK, importFirma: 'Winta Plus' },
  { no: 9, exportFirm: 'Tel.Hemidov P', shortCode: 'TPH', kontroktNom: '001', invoiceNom: '9', ...DATALAR_BLANK, importFirma: 'Krasnyý apelsin' },
  { no: 10, exportFirm: 'Tel.Hemidov Ç', shortCode: 'TCH', kontroktNom: '001', invoiceNom: '10', ...DATALAR_BLANK, importFirma: 'Dar zemli' },
  { no: 11, exportFirm: 'Tel.Amangeldiyew G.', shortCode: 'TGA', kontroktNom: '001', invoiceNom: '11', ...DATALAR_BLANK },
  { no: 12, exportFirm: 'Tel.Jumamyradov G.', shortCode: 'TJG', kontroktNom: '001', invoiceNom: '12', ...DATALAR_BLANK },
  { no: 13, exportFirm: 'Yumak', shortCode: 'YMK', kontroktNom: '001', invoiceNom: '13', ...DATALAR_BLANK },
  { no: 14, exportFirm: 'Işgär', shortCode: 'ISH', kontroktNom: '002', invoiceNom: '14', ...DATALAR_BLANK },
  { no: 15, exportFirm: 'Ygtybarly Enjam', shortCode: 'YE', kontroktNom: '001', invoiceNom: '15', ...DATALAR_BLANK },
];
