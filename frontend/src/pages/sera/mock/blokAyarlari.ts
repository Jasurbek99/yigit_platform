/**
 * Blok Sazlamalary (Blok Ayarları) — page-specific mock config.
 *
 * Extra per-block settings not carried by the shared `SERA_BLOCKS` dataset:
 * the "Açylyş Senesi" (Açılış Tarihi) a block started incurring costs from.
 * `null` means the block has no opening date recorded yet (shown as an
 * empty date field in the source app, no green confirmation note).
 */

export interface BlockOpeningSetting {
  readonly blockId: string;
  readonly openingDate: string | null; // YYYY-MM-DD
}

export const BLOCK_OPENING_SETTINGS: readonly BlockOpeningSetting[] = [
  // Duşak Bölümi
  { blockId: 'DUS-A', openingDate: '2026-01-01' },
  { blockId: 'DUS-B', openingDate: '2026-01-01' },
  { blockId: 'DUS-C', openingDate: '2026-01-01' },
  { blockId: 'DUS-1', openingDate: null },
  { blockId: 'DUS-2', openingDate: null },
  { blockId: 'DUS-3', openingDate: null },
  { blockId: 'DUS-4', openingDate: null },
  { blockId: 'DUS-5', openingDate: null },
  { blockId: 'DUS-6', openingDate: null },
  { blockId: 'DUS-7', openingDate: null },
  { blockId: 'DUS-8', openingDate: null },
  { blockId: 'DUS-9', openingDate: null },
  { blockId: 'DUS-10', openingDate: null },
  // Kaka Bölümi
  { blockId: 'KAK-D', openingDate: '2026-01-01' },
  { blockId: 'KAK-E', openingDate: '2026-01-01' },
  { blockId: 'KAK-F', openingDate: '2026-01-01' },
  { blockId: 'KAK-G', openingDate: '2026-01-01' },
  { blockId: 'KAK-H', openingDate: '2026-01-01' },
  { blockId: 'KAK-I', openingDate: '2026-01-01' },
  { blockId: 'KAK-J', openingDate: '2026-01-01' },
  { blockId: 'KAK-K', openingDate: '2026-01-01' },
  { blockId: 'KAK-L', openingDate: '2026-01-01' },
  { blockId: 'KAK-N', openingDate: null },
  { blockId: 'KAK-P', openingDate: null },
  { blockId: 'KAK-M15', openingDate: '2026-01-01' },
  { blockId: 'KAK-M5', openingDate: '2026-01-01' },
  // Owadandepe Bölümi
  { blockId: 'OWA-O', openingDate: null },
];

export const BLOCK_OPENING_MAP: Record<string, string | null> = Object.fromEntries(
  BLOCK_OPENING_SETTINGS.map((s) => [s.blockId, s.openingDate]),
);

/** Turkmen display label per SERA_BLOCKS group code. */
export const GROUP_LABELS_TK: Record<'Dusak' | 'Kaka' | 'Owadandepe', string> = {
  Dusak: 'Duşak',
  Kaka: 'Kaka',
  Owadandepe: 'Owadandepe',
};
