/**
 * Pazarlama & Gaplama (760) — page-specific mock data.
 *
 * Figures transcribed from the source "Sera Bütçe Yönetimi" app (760.01 …
 * 760.05 cost tables, Domates product). UI-only prototype — no API.
 */

export const STANDARD_TIR_KG = 20000;

// ─── Product type chips ─────────────────────────────────────────────────
export interface ProductType {
  readonly code: string;
  readonly name: string;
}

export const PRODUCT_TYPES: readonly ProductType[] = [
  { code: 'domates', name: 'Domates' },
  { code: 'hyyra', name: 'HYYRA' },
  { code: 'hyyar', name: 'hyyar' },
  { code: 'ggfggf', name: 'ggfggf' },
  { code: 'alma', name: 'Alma' },
  { code: 'sdss', name: 'sdss' },
  { code: 'dfdf', name: 'dfdf' },
];

// ─── Monthly export + kapı satış kg (Domates, all blocks, iç pazar hariç) ─
export const MONTHLY_EXPORT_KG: readonly number[] = [
  5750984, 5955829, 7197974, 12190868, 11879218, 5669118, 0, 0, 0, 0, 0, 0,
];

export const YEARLY_TOTAL_USD = 102642876;

// ─── 760.01 / 760.02 — expense item rows ────────────────────────────────
export type HesapTuru = 'Kg (İhracat)' | 'Tır' | 'İç Pazar Yeşigi';

export interface ExpenseItem {
  readonly id: string;
  readonly name: string;
  readonly hesapTuru: HesapTuru;
  readonly birimFiyat: number;
  readonly paraBirimi: 'DTM' | 'USD';
  readonly monthly: readonly number[];
  readonly toplam: number;
  /** Tır-based detail (only when hesapTuru === 'Tır') */
  readonly birimPerTir?: number;
  readonly tirMonthly?: readonly number[];
  readonly birimSayisiMonthly?: readonly (number | null)[];
  readonly birimSayisiToplam?: number;
  /** Yeşik-based detail (only when hesapTuru !== 'Tır') */
  readonly perYesikKg?: number;
  readonly yesikKgMonthly?: readonly number[];
  readonly yesikSayisiMonthly?: readonly (number | null)[];
  readonly yesikSayisiToplam?: number;
}

const TIR_MONTHLY = [287.55, 297.79, 359.9, 609.54, 593.96, 283.46, 0, 0, 0, 0, 0, 0] as const;
const BIRIM_SAYISI_33 = [9489, 9827, 11877, 20115, 19601, 9354, null, null, null, null, null, null] as const;
const YESIK_SAYISI_6 = [958497, 992638, 1199662, 2031811, 1979870, 944853, null, null, null, null, null, null] as const;

export const GAPLAMA_ITEMS: readonly ExpenseItem[] = [
  {
    id: 'palet', name: 'Palet çykdajylary', hesapTuru: 'Tır', birimFiyat: 90, paraBirimi: 'DTM',
    monthly: [854021, 884441, 1068899, 1810344, 1764064, 841864, 0, 0, 0, 0, 0, 0], toplam: 7223633,
    birimPerTir: 33, tirMonthly: TIR_MONTHLY, birimSayisiMonthly: BIRIM_SAYISI_33, birimSayisiToplam: 80263,
  },
  {
    id: 'yesik16', name: 'Yesik (16 LIK)', hesapTuru: 'Kg (İhracat)', birimFiyat: 6, paraBirimi: 'DTM',
    monthly: [...MONTHLY_EXPORT_KG], toplam: 48643991,
    perYesikKg: 6, yesikKgMonthly: MONTHLY_EXPORT_KG, yesikSayisiMonthly: YESIK_SAYISI_6, yesikSayisiToplam: 8107332,
  },
  {
    id: 'ustkagyz', name: 'Üst Kagyz', hesapTuru: 'Tır', birimFiyat: 5, paraBirimi: 'DTM',
    monthly: [47446, 49136, 59383, 100575, 98004, 46770, 0, 0, 0, 0, 0, 0], toplam: 401313,
    birimPerTir: 33, tirMonthly: TIR_MONTHLY, birimSayisiMonthly: BIRIM_SAYISI_33, birimSayisiToplam: 80263,
  },
  {
    id: 'burc', name: 'Burç (gyra) goraýjylary', hesapTuru: 'Kg (İhracat)', birimFiyat: 3, paraBirimi: 'DTM',
    monthly: [2875492, 2977914, 3598987, 6095434, 5939609, 2834559, 0, 0, 0, 0, 0, 0], toplam: 24321996,
    perYesikKg: 6, yesikKgMonthly: MONTHLY_EXPORT_KG, yesikSayisiMonthly: YESIK_SAYISI_6, yesikSayisiToplam: 8107332,
  },
  {
    id: 'lenta', name: 'Gaplaýyş lentasynyň bahasy', hesapTuru: 'Kg (İhracat)', birimFiyat: 1, paraBirimi: 'DTM',
    monthly: [958497, 992638, 1199662, 2031811, 1979870, 944853, 0, 0, 0, 0, 0, 0], toplam: 8107332,
    perYesikKg: 6, yesikKgMonthly: MONTHLY_EXPORT_KG, yesikSayisiMonthly: YESIK_SAYISI_6, yesikSayisiToplam: 8107332,
  },
  {
    id: 'belliklerin', name: 'Ýelmeýji belliklerin bahasy', hesapTuru: 'Kg (İhracat)', birimFiyat: 1, paraBirimi: 'DTM',
    monthly: [958497, 992638, 1199662, 2031811, 1979870, 944853, 0, 0, 0, 0, 0, 0], toplam: 8107332,
    perYesikKg: 6, yesikKgMonthly: MONTHLY_EXPORT_KG, yesikSayisiMonthly: YESIK_SAYISI_6, yesikSayisiToplam: 8107332,
  },
  {
    id: 'dsdsds', name: 'dsdsds', hesapTuru: 'İç Pazar Yeşigi', birimFiyat: 0, paraBirimi: 'DTM',
    monthly: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], toplam: 0,
    perYesikKg: 6,
    yesikKgMonthly: [784225, 812158, 981542, 1662391, 3959739, 3052602, 0, 0, 0, 0, 0, 0],
    yesikSayisiMonthly: [130704, 135360, 163590, 277065, 659957, 508767, null, null, null, null, null, null],
    yesikSayisiToplam: 1875443,
  },
];
export const GAPLAMA_GRUP_TOPLAMI = {
  monthly: [11444938, 11852595, 14324568, 24260844, 23640635, 11282017, null, null, null, null, null, null] as const,
  toplam: 96805597,
};

export const GUMRUKLEME_ITEMS: readonly ExpenseItem[] = [
  {
    id: 'gumruk', name: 'Gümrük çykdajylary', hesapTuru: 'Tır', birimFiyat: 2400, paraBirimi: 'DTM',
    monthly: [690118, 714699, 863757, 1462904, 1425506, 680294, 0, 0, 0, 0, 0, 0], toplam: 5837279,
    birimPerTir: 1, tirMonthly: TIR_MONTHLY,
    birimSayisiMonthly: [288, 298, 360, 610, 594, 283, null, null, null, null, null, null],
    birimSayisiToplam: 2432,
  },
  {
    id: 'telekeciler', name: 'Telekeçiler birleşmesi çykdajylary', hesapTuru: 'Tır', birimFiyat: 0, paraBirimi: 'DTM',
    monthly: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], toplam: 0,
    birimPerTir: 33, tirMonthly: TIR_MONTHLY, birimSayisiMonthly: BIRIM_SAYISI_33, birimSayisiToplam: 80263,
  },
];
export const GUMRUKLEME_GRUP_TOPLAMI = {
  monthly: [690118, 714699, 863757, 1462904, 1425506, 680294, null, null, null, null, null, null] as const,
  toplam: 5837279,
};

// ─── 760.03 / 760.04 — country-based Nakliye / Daşary gümrükleme tables ──
export interface CountryLine {
  readonly country: string;
  readonly kgMonthly: readonly number[];
  readonly tirMonthly: readonly number[];
  readonly fiyatRows: readonly { readonly label: string; readonly values: readonly number[]; readonly toplamUsd: number }[];
  readonly tutarMonthly: readonly (number | null)[];
  readonly tutarToplam: number;
}

const KAZAKISTAN_KG = [2875492, 2858798, 3311068, 5607800, 4989272, 3061324, 0, 0, 0, 0, 0, 0];
const KAZAKISTAN_TIR = [143.77, 142.94, 165.55, 280.39, 249.46, 153.07, 0, 0, 0, 0, 0, 0];
const RUSYA_KG = [1437746, 1250724, 2015433, 2560082, 3088597, 1360588, 0, 0, 0, 0, 0, 0];
const RUSYA_TIR = [71.89, 62.54, 100.77, 128, 154.43, 68.03, 0, 0, 0, 0, 0, 0];
const NONE12: readonly null[] = [null, null, null, null, null, null, null, null, null, null, null, null];

export const NAKLIYE: {
  readonly headerNote: string;
  readonly yillikToplamUsd: number;
  readonly kazakistan: CountryLine;
  readonly rusya: CountryLine;
  readonly toplamMonthly: readonly (number | null)[];
  readonly toplamUsd: number;
} = {
  headerNote: 'Birim: USD / Tır | 1 Tır = 20.000 kg',
  yillikToplamUsd: 697307,
  kazakistan: {
    country: 'Kazakistan', kgMonthly: KAZAKISTAN_KG, tirMonthly: KAZAKISTAN_TIR,
    fiyatRows: [
      { label: 'Fiyat 1 (USD/Tır)', values: [3850, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], toplamUsd: 553532 },
      { label: 'Fiyat 2 (USD/Tır)', values: [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], toplamUsd: 143775 },
    ],
    tutarMonthly: [697307, ...NONE12.slice(1)], tutarToplam: 697307,
  },
  rusya: {
    country: 'Rusya', kgMonthly: RUSYA_KG, tirMonthly: RUSYA_TIR,
    fiyatRows: [{ label: 'Fiyat (USD/Tır)', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], toplamUsd: 0 }],
    tutarMonthly: NONE12, tutarToplam: 0,
  },
  toplamMonthly: [697307, ...NONE12.slice(1)], toplamUsd: 697307,
};

export const DASARY_GUMRUKLEME: {
  readonly headerNote: string;
  readonly yillikToplamUsd: number;
  readonly kazakistan: CountryLine;
  readonly rusya: CountryLine;
  readonly toplamMonthly: readonly (number | null)[];
  readonly toplamUsd: number;
} = {
  headerNote: 'Birim: USD / Tır | 1 Tır = 20.000 kg',
  yillikToplamUsd: 0,
  kazakistan: {
    country: 'Kazakistan', kgMonthly: KAZAKISTAN_KG, tirMonthly: KAZAKISTAN_TIR,
    fiyatRows: [{ label: 'Fiyat (USD/Tır)', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], toplamUsd: 0 }],
    tutarMonthly: NONE12, tutarToplam: 0,
  },
  rusya: {
    country: 'Rusya', kgMonthly: RUSYA_KG, tirMonthly: RUSYA_TIR,
    fiyatRows: [{ label: 'Fiyat (USD/Tır)', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], toplamUsd: 0 }],
    tutarMonthly: NONE12, tutarToplam: 0,
  },
  toplamMonthly: NONE12, toplamUsd: 0,
};

// ─── 760.05 — Daşary ýurt satyşy bilen baglanyşykly çykdajylar ──────────
export interface SalesExpenseGroup {
  readonly label: string;
  readonly toplamUsd: number;
  readonly kazakistanFiyat: readonly number[];
  readonly rusyaFiyat: readonly number[];
}

export const SATYS_ILISIKLI_GROUPS: readonly SalesExpenseGroup[] = [
  { label: 'Satyjynyň premiýa çykdajysy (USD/Tır)', toplamUsd: 0, kazakistanFiyat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], rusyaFiyat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { label: 'Satyjynyň bazar çykdajysy (USD/Kg)', toplamUsd: 0, kazakistanFiyat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], rusyaFiyat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { label: 'Satyjynyň bazara giriş üçin çykdajylary (USD/Tır)', toplamUsd: 0, kazakistanFiyat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], rusyaFiyat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { label: 'Satyjynyň bankdan pul ýollamak çykdajysy (USD/Tır)', toplamUsd: 0, kazakistanFiyat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], rusyaFiyat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
];

export const ISGARLER_AUTO_ROW = {
  label: 'Daşary ýurt işgärleriň aýlyk çykdajysy (Personel sayfasından otomatik)',
  monthly: [1000, ...NONE12.slice(1)] as readonly (number | null)[],
  toplam: 1000,
  kazakistanKisi: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  kazakistanToplamUsd: 1000,
  rusyaKisi: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  rusyaToplamUsd: 0,
};
export const SATYS_ILISIKLI_TOPLAM = { monthly: [1000, ...NONE12.slice(1)] as readonly (number | null)[], toplam: 1000 };

// ─── Aylık Toplam Özeti — Domates ────────────────────────────────────────
export interface OzetRow {
  readonly label: string;
  readonly monthly: readonly (number | null)[];
  readonly toplam: number;
}

export const AYLIK_OZET: readonly OzetRow[] = [
  { label: '760.01 — Gaplama Çykdajylary', monthly: [11444938, 11852595, 14324568, 24260844, 23640635, 11282017, null, null, null, null, null, null], toplam: 96805597 },
  { label: '760.02 — Gümrükleme (Gümrük çykdajylary)', monthly: [690118, 714699, 863757, 1462904, 1425506, 680294, null, null, null, null, null, null], toplam: 5837279 },
  { label: '760.03 — Nakliye', monthly: NONE12, toplam: 0 },
  { label: '760.04 — Daşary ýurt gümrükleme çykdajylary', monthly: NONE12, toplam: 0 },
  { label: '760.05 — Daşary ýurt satyşy bilen baglanyşykly çykdajylar', monthly: NONE12, toplam: 0 },
];
export const AYLIK_GENEL_TOPLAM: OzetRow = {
  label: '760 Genel Toplam',
  monthly: [12135056, 12567295, 15188325, 25723748, 25066141, 11962311, null, null, null, null, null, null],
  toplam: 102642876,
};
