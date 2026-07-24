/**
 * Sera Bütçe — "Çykdajylar / Genel Giderler" page mock dataset (2026).
 *
 * Figures transcribed from the source "Sera Bütçe Yönetimi" app's Giderler
 * screen (categories 710 / 720 / 730 / 760 / 770). UI-only prototype — no API.
 * `null` month values render as "—" (no activity that month); `0` renders as
 * "0 $" (activity tracked, zero amount).
 */

export type MonthValues = readonly (number | null)[]; // 12 entries: Ocak..Aralık

export interface ExpenseRow {
  readonly label: string;
  readonly months: MonthValues;
  readonly total: number;
  readonly bold?: boolean;
  readonly indent?: boolean;
}

export interface ExpenseGroup {
  readonly title: string;
  readonly total: number;
  readonly rows: readonly ExpenseRow[];
  readonly groupTotal: ExpenseRow;
}

const NULL_12: MonthValues = [null, null, null, null, null, null, null, null, null, null, null, null];
const ZERO_12: MonthValues = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// ─── 710 — İlk Madde ve Malzeme (Gübre) ─────────────────────────────────
export const R710: readonly ExpenseRow[] = [
  { label: 'Gübre', months: [10994, 5968, 4356, 4356, 7596, 7530, 744, 0, 0, 0, 0, 0], total: 41544 },
  { label: 'Tohum', months: [0, 0, 0, 0, 0, 0, 187180, 5880, 0, 0, 0, 0], total: 193060 },
  { label: 'Kokopeat', months: [0, 0, 0, 0, 0, 0, 229200, 7200, 0, 0, 0, 0], total: 236400 },
  { label: 'Kübik (Taş Yünü)', months: [0, 0, 0, 0, 0, 0, 35460, 0, 0, 0, 0, 0], total: 35460 },
  { label: 'İlaç', months: ZERO_12, total: 0 },
];
export const R710_TOTAL: ExpenseRow = {
  label: 'TOPLAM (710)',
  months: [10994, 5968, 4356, 4356, 7596, 7530, 452584, 13080, 0, 0, 0, 0],
  total: 506464,
};

// ─── 720 — İşçilik Maliyetleri ──────────────────────────────────────────
export const R720: readonly ExpenseRow[] = [
  { label: '720.720 — Üretim İşçileri', months: ZERO_12, total: 0 },
  { label: '720.730 — Yönetim/Müdürler & Hojalyk/Bakım', months: ZERO_12, total: 0 },
  { label: '720.750 — Hil Gözegçi İşgärleri', months: ZERO_12, total: 0 },
  { label: '720.760 — Gaplama (Paketleme)', months: ZERO_12, total: 0 },
  { label: '720.770 — Umumy Dolandyryş (Bölümlerde paylaşılır)', months: ZERO_12, total: 0 },
  { label: 'Pensiýa ätiýaçlandyrylmasy (20%)', months: ZERO_12, total: 0 },
  { label: 'Işgärleriň girdeji salgydy (10%)', months: ZERO_12, total: 0 },
  { label: 'Işgärleri gatnatmak çykdajylary', months: ZERO_12, total: 0 },
  { label: 'Işgärleriň saglygy boýunça çykdajylar', months: ZERO_12, total: 0 },
  { label: 'Şäher abadanlaşdyrma çykdajysy', months: Array(12).fill(1290) as number[], total: 15480 },
];
export const R720_TOTAL: ExpenseRow = {
  label: 'TOPLAM (720)',
  months: Array(12).fill(1290) as number[],
  total: 15480,
};

// ─── 730 — Genel Üretim Giderleri ───────────────────────────────────────
export const G730_ENERGY: ExpenseGroup = {
  title: 'Energiýa we kommunal çykdajylar',
  total: 1243382,
  rows: [
    { label: 'Elektrik energiýasy', months: [394, 12, null, 56668, 76260, 89900, null, null, null, null, null, null], total: 223234 },
    { label: 'Ýangyç çykdajylary', months: [124, 50220, 51460, 52080, 55800, 54560, null, null, null, null, null, null], total: 264244 },
    { label: 'Tebigy gaz üpjünçiligi', months: [124, 122698, 125178, 32178, 8618, 4898, null, null, null, null, null, null], total: 293694 },
    { label: 'Internet hyzmatlary', months: [124, 13491, 13491, 13491, 13491, 13491, null, null, null, null, null, null], total: 67580 },
    { label: 'Suw üpjünçilik hyzmatlary', months: [124, 78740, 78740, 78740, 78740, 78740, null, null, null, null, null, null], total: 393824 },
    { label: 'Telefon aragatnaşyk hyzmatlary', months: [124, 136, 136, 136, 136, 136, null, null, null, null, null, null], total: 806 },
  ],
  groupTotal: {
    label: 'Grup Toplamı',
    months: [1014, 265298, 269006, 233294, 233046, 241726, null, null, null, null, null, null],
    total: 1243382,
  },
};

export const G730_REPAIR: ExpenseGroup = {
  title: 'Remont we abatlaýyş çykdajylary',
  total: 6150983,
  rows: [
    { label: 'Ýyladyşhananyň abatlaýyş işleri', months: [311674, 311674, 311674, 519461, 727248, 727248, null, null, null, null, null, null], total: 2908978 },
    { label: 'Beýleki abatlaýyş işleri', months: [58106, 67878, 572508, 79943, 98964, 30268, null, null, null, null, null, null], total: 907668 },
    { label: 'Enjamlary abatlamak', months: [20435, 20435, 20435, 20435, 20435, 20435, null, null, null, null, null, null], total: 122611 },
    { label: 'Elektrik enjamlaryny abatlamak', months: [77562, 201934, 107570, 53543, 58292, 63116, null, null, null, null, null, null], total: 562018 },
    { label: 'Awtoulaglary abatlamak', months: [239432, 316932, 207452, 224043, 210217, 178833, null, null, null, null, null, null], total: 1376908 },
    { label: 'Daşky böleklerini hekläp aklamak', months: [null, null, 186000, 86800, null, null, null, null, null, null, null, null], total: 272800 },
  ],
  groupTotal: {
    label: 'Grup Toplamı',
    months: [707209, 918852, 1405639, 984225, 1115157, 1019900, null, null, null, null, null, null],
    total: 6150983,
  },
};

export const G730_OTHER: ExpenseGroup = {
  title: 'Beýleki umumy önümçilik çykdajylary',
  total: 3874058,
  rows: [
    { label: 'Işgärleriň nahar (iýmit) çykdajylary', months: [589112, 595671, 602218, 598213, 604760, 604760, null, null, null, null, null, null], total: 3594735 },
    { label: 'Beýleki gaýry çykdajylar', months: [4836, 3571, 6795, 9089, 8258, 21936, null, null, null, null, null, null], total: 54486 },
    { label: 'Möwsümleýin arassaçylyk çykdajylary', months: [12400, 12400, 12400, 12400, 12400, 12400, null, null, null, null, null, null], total: 74400 },
    { label: 'Sanitar-arassaçylyk çykdajylary', months: [24986, 25048, 25234, 25358, 24862, 24949, null, null, null, null, null, null], total: 150437 },
    { label: 'Hojalyk harytlary we hyzmatlary', months: NULL_12, total: 0 },
    { label: 'Kiçi göwrümli sarp ediş serişdeleri', months: NULL_12, total: 0 },
    { label: 'Iş eşikleri we gurallary', months: NULL_12, total: 0 },
    { label: 'Kanselýariýa harytlary', months: NULL_12, total: 0 },
  ],
  groupTotal: {
    label: 'Grup Toplamı',
    months: [631334, 636690, 646648, 645060, 650281, 664045, null, null, null, null, null, null],
    total: 3874058,
  },
};

export const R730_TOTAL = 11268423;

// ─── 760 — Pazarlama, Satış ve Dağıtım ──────────────────────────────────
export const R760: readonly ExpenseRow[] = [
  { label: '760.01 — Gaplama Çykdajylary', bold: true, months: [586920, 607825, 734593, 1244146, 1212340, 578565, null, null, null, null, null, null], total: 4964390 },
  { label: 'Palet çykdajylary', indent: true, months: [43796, 45356, 54815, 92838, 90465, 43173, null, null, null, null, null, null], total: 370443 },
  { label: 'Yesik (16 LIK)', indent: true, months: [294922, 305427, 369127, 625173, 609191, 290724, null, null, null, null, null, null], total: 2494564 },
  { label: 'Üst Kagyz', indent: true, months: [2433, 2520, 3045, 5158, 5026, 2398, null, null, null, null, null, null], total: 20580 },
  { label: 'Burç (gyra) goraýjylary', indent: true, months: [147461, 152714, 184563, 312586, 304595, 145362, null, null, null, null, null, null], total: 1247282 },
  { label: 'Gaplaýyş lentasynyň bahasy', indent: true, months: [49154, 50905, 61521, 104195, 101532, 48454, null, null, null, null, null, null], total: 415761 },
  { label: 'Ýelmeýji belliklerin bahasy', indent: true, months: [49154, 50905, 61521, 104195, 101532, 48454, null, null, null, null, null, null], total: 415761 },
  { label: 'dsdsds', indent: true, months: NULL_12, total: 0 },
  { label: '760.02 — Gümrükleme (Gümrük çykdajylary)', bold: true, months: [35391, 36651, 44295, 75021, 73103, 34887, null, null, null, null, null, null], total: 299348 },
  { label: 'Gümrük çykdajylary', indent: true, months: [35391, 36651, 44295, 75021, 73103, 34887, null, null, null, null, null, null], total: 299348 },
  { label: 'Telekeçiler birleşmesi çykdajylary', indent: true, months: NULL_12, total: 0 },
  { label: '760.03 — Nakliye', bold: true, months: [697307, null, null, null, null, null, null, null, null, null, null, null], total: 697307 },
  { label: 'Kazakistan', indent: true, months: [697307, null, null, null, null, null, null, null, null, null, null, null], total: 697307 },
  { label: '760.04 — Daşary ýurt gümrükleme çykdajylary', bold: true, months: NULL_12, total: 0 },
  { label: '760.05 — Daşary ýurt satyşy bilen baglanyşykly çykdajylar', bold: true, months: NULL_12, total: 0 },
];
export const R760_TOTAL: ExpenseRow = {
  label: 'TOPLAM (760)',
  months: [1319617, 644477, 778888, 1319167, 1285443, 613452, null, null, null, null, null, null],
  total: 5961044,
};

// ─── 770 — Genel Yönetim (Havuz) ────────────────────────────────────────
export const R770_TOP_TOTAL: ExpenseRow = { label: 'TOPLAM (770)', months: NULL_12, total: 0 };

export const G770_DOLANDYRYS: ExpenseGroup = {
  title: 'Dolandyryş Çykdajylary',
  total: 0,
  rows: [
    { label: 'Dolandyryş — Resmi Dokument Tazelemek Üçin Çykdaj', months: NULL_12, total: 0 },
    { label: 'Dolandyryş — Telekeçiler Birleşigi Giderleri', months: NULL_12, total: 0 },
    { label: 'Dolandyryş — Awtoulag Remont We Bejergi Çykdajylary', months: NULL_12, total: 0 },
    { label: 'Dolandyryş — Bank Çykdajylary', months: NULL_12, total: 0 },
    { label: 'Dolandyryş — Taksi Çykdajylary', months: NULL_12, total: 0 },
    { label: 'Dolandyryş — IK Çykdajylar', months: NULL_12, total: 0 },
    { label: 'Dolandyryş — Naharhana Çykdajylary', months: NULL_12, total: 0 },
    { label: 'Dolandyryş — Konselyar Harytlar Çykdajylary', months: NULL_12, total: 0 },
    { label: 'Dolandyryş — Fuar Çykdajylary', months: NULL_12, total: 0 },
    { label: 'Dolandyryş — Reklama Çykdajylary', months: NULL_12, total: 0 },
  ],
  groupTotal: { label: 'Grup Toplamı', months: NULL_12, total: 0 },
};

export const G770_OFIS: ExpenseGroup = {
  title: 'Ofis Çykdajylary',
  total: 0,
  rows: [
    { label: 'Ofis — Arenda Çykdajylary', months: NULL_12, total: 0 },
    { label: 'Ofis — Beýleki Çykdajylary', months: NULL_12, total: 0 },
  ],
  groupTotal: { label: 'Grup Toplamı', months: NULL_12, total: 0 },
};
