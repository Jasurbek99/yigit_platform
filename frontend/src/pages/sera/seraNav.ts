/**
 * Sera Bütçe — internal navigation config.
 *
 * The module lives under `/sera` inside the YGT app shell, with its own
 * horizontal top-nav (mirroring the source app) plus a Bütçe hub grid.
 * Routes are relative to `/sera`.
 */

export interface SeraNavItem {
  readonly path: string; // relative to /sera (empty string = index)
  readonly label: string;
}

/** Primary horizontal nav (matches the source app's top tabs). */
export const SERA_TOP_NAV: readonly SeraNavItem[] = [
  { path: '', label: 'Ana Sahypa' },
  { path: 'dashboard', label: 'Esasy Dashboard' },
  { path: 'butce', label: 'Býujet' },
  { path: 'pomidor', label: 'Pomidor Dükany' },
  { path: 'izleme', label: 'Sera Gözegçiligi' },
  { path: 'tir-takip', label: 'Maşyn Yzarlama' },
  { path: 'yurtdisi-hasabat', label: 'Daşary Hasabat' },
  { path: 'finans-hasabatlar', label: 'Maliýe Hasabatlar' },
  { path: 'yardim', label: 'Kömek' },
  { path: 'ayarlar', label: 'Sazlamalar' },
];

/** The 15 Bütçe hub section cards / sub-routes. */
export interface SeraButceSection {
  readonly slug: string; // relative to /sera/butce
  readonly label: string;
  readonly icon: string; // tabler icon name key (see SeraButceHub)
  readonly color: string;
}

export const SERA_BUTCE_SECTIONS: readonly SeraButceSection[] = [
  { slug: 'dashboard', label: 'Býujet Dashboard', icon: 'dashboard', color: '#0f7a52' },
  { slug: 'uretim-plani', label: 'Önümçilik Meýilnamasy', icon: 'calendar', color: '#0f7a52' },
  { slug: 'gunluk-uretim', label: 'Günlük Önümçilik', icon: 'clipboard', color: '#0f7a52' },
  { slug: 'uretim', label: 'Önümçilik', icon: 'plant', color: '#16a34a' },
  { slug: 'personel', label: 'Işgärler', icon: 'users', color: '#db2777' },
  { slug: 'gubre', label: 'Dökün', icon: 'flask', color: '#65a30d' },
  { slug: 'sarf-malzemeleri', label: 'Sarp Materiallary', icon: 'box', color: '#7c3aed' },
  { slug: 'genel-uretim-gideri', label: 'Umumy Önümçilik Çykdajysy', icon: 'receipt', color: '#ca8a04' },
  { slug: 'pazarlama-gaplama', label: 'Marketing & Gaplama', icon: 'cart', color: '#ea580c' },
  { slug: 'genel-yonetim-giderleri', label: 'Umumy Dolandyryş Çykdajylary', icon: 'building', color: '#2563eb' },
  { slug: 'yonetim-raporlari', label: 'Dolandyryş Hasabatlary', icon: 'report', color: '#16a34a' },
  { slug: 'giderler', label: 'Çykdajylar', icon: 'invoice', color: '#0284c7' },
  { slug: 'satis', label: 'Satyş', icon: 'shopping', color: '#b45309' },
  { slug: 'raporlar', label: 'Hasabatlar', icon: 'chart', color: '#16a34a' },
  { slug: 'blok-ayarlari', label: 'Blok Sazlamalary', icon: 'settings', color: '#334155' },
];
