/**
 * Genel Üretim Gideri (730) — page-specific mock data.
 *
 * Figures transcribed from the source "Sera Bütçe Yönetimi" app's Genel Üretim
 * Gideri screen (Soğutmalı / Domates scope). UI-only prototype — no API.
 * Monthly arrays are Ocak…Aralık (index 0-11); Temmuz onward are 0 (not yet
 * entered for the current season).
 */

export interface GugItem {
  readonly label: string;
  readonly months: readonly number[];
}

export interface GugGroup {
  readonly name: string;
  readonly items: readonly GugItem[];
}

export const GUG_PRODUCT_TYPES: readonly string[] = ['Domates', 'HYYRA', 'hyyar', 'ggfggf', 'Alma', 'sdss', 'dfdf'];

export const GUG_GROUPS: readonly GugGroup[] = [
  {
    name: 'Energiýa we kommunal çykdajylar',
    items: [
      { label: 'Elektrik energiýasy', months: [10, 1, 0, 4570, 6150, 7250, 0, 0, 0, 0, 0, 0] },
      { label: 'Ýangyç çykdajylary', months: [10, 4050, 4150, 4200, 4500, 4400, 0, 0, 0, 0, 0, 0] },
      { label: 'Tebigy gaz üpjünçiligi', months: [10, 9895, 10095, 2595, 695, 395, 0, 0, 0, 0, 0, 0] },
      { label: 'Internet hyzmatlary', months: [10, 1088, 1088, 1088, 1088, 1088, 0, 0, 0, 0, 0, 0] },
      { label: 'Suw üpjünçilik hyzmatlary', months: [10, 6350, 6350, 6350, 6350, 6350, 0, 0, 0, 0, 0, 0] },
      { label: 'Telefon aragatnaşyk hyzmatlary', months: [10, 11, 11, 11, 11, 11, 0, 0, 0, 0, 0, 0] },
    ],
  },
  {
    name: 'Remont we abatlaýyş çykdajylary',
    items: [
      { label: 'Ýyladyşhananyň abatlaýyş işleri', months: [25135, 25135, 25135, 41892, 58649, 58649, 0, 0, 0, 0, 0, 0] },
      { label: 'Beýleki abatlaýyş işleri', months: [4686, 5474, 46170, 6447, 7981, 2441, 0, 0, 0, 0, 0, 0] },
      { label: 'Enjamlary abatlamak', months: [1648, 1648, 1648, 1648, 1648, 1648, 0, 0, 0, 0, 0, 0] },
      { label: 'Elektrik enjamlaryny abatlamak', months: [6255, 16285, 8675, 4318, 4701, 5090, 0, 0, 0, 0, 0, 0] },
      { label: 'Awtoulaglary abatlamak', months: [19309, 25559, 16730, 18068, 16953, 14422, 0, 0, 0, 0, 0, 0] },
      { label: 'Daşky böleklerini hekläp aklamak', months: [0, 0, 15000, 7000, 0, 0, 0, 0, 0, 0, 0, 0] },
    ],
  },
  {
    name: 'Beýleki umumy önümçilik çykdajylary',
    items: [
      { label: 'Işgärleriň nahar (iýmit) çykdajylary', months: [47509, 48038, 48566, 48243, 48771, 48771, 0, 0, 0, 0, 0, 0] },
      { label: 'Beýleki gaýry çykdajylar', months: [390, 288, 548, 733, 666, 1769, 0, 0, 0, 0, 0, 0] },
      { label: 'Möwsümleýin arassaçylyk çykdajylary', months: [1000, 1000, 1000, 1000, 1000, 1000, 0, 0, 0, 0, 0, 0] },
      { label: 'Sanitar-arassaçylyk çykdajylary', months: [2015, 2020, 2035, 2045, 2005, 2012, 0, 0, 0, 0, 0, 0] },
      { label: 'Hojalyk harytlary we hyzmatlary', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      { label: 'Kiçi göwrümli sarp ediş serişdeleri', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      { label: 'Iş eşikleri we gurallary', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      { label: 'Kanselýariýa harytlary', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    ],
  },
];

export function gugItemTotal(item: GugItem): number {
  return item.months.reduce((sum, v) => sum + v, 0);
}

export function gugGroupTotal(group: GugGroup): number {
  return group.items.reduce((sum, item) => sum + gugItemTotal(item), 0);
}

export function gugGroupMonthlyTotals(group: GugGroup): readonly number[] {
  return Array.from({ length: 12 }, (_, m) => group.items.reduce((sum, item) => sum + item.months[m], 0));
}

export const GUG_GRAND_TOTAL: number = GUG_GROUPS.reduce((sum, g) => sum + gugGroupTotal(g), 0);
