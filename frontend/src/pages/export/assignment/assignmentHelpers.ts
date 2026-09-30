import dayjs from 'dayjs';
import { COLORS } from '@/constants/styles';
import type { IShipmentDraft } from '@/types';

export const FRESHNESS_BORDER: Record<'today' | 'yesterday' | 'aged', string> = {
  today: COLORS.success,
  yesterday: COLORS.warning,
  aged: COLORS.danger,
};

/** One filled line on a board card; `key` is the `assign.detail.<key>` label. */
export interface ICardDetail {
  key: string;
  value: string;
}

function kg(n: number): string {
  return n.toLocaleString('ru-RU');
}

function joinFilled(parts: (string | null | undefined)[], sep: string): string {
  return parts.filter((p) => p != null && p !== '').join(sep);
}

/** "A 9 000 · B 3 000": one entry per block — a block's harvest batches summed. */
function blocksWithKg(d: IShipmentDraft): string {
  const byBlock = new Map<string, number | null>();
  for (const s of d.block_sources) {
    const prev = byBlock.get(s.block_code) ?? null;
    byBlock.set(s.block_code, s.weight_kg == null ? prev : (prev ?? 0) + s.weight_kg);
  }
  return Array.from(byBlock, ([code, w]) => (w == null ? code : `${code} ${kg(w)}`)).join(' · ');
}

/**
 * Every filled detail of an Assignment board card, in display order — empty fields
 * are left out, so a packing part shows its packing facts and an export part its
 * destination facts from the same list. Code, export code and kg sit in the card
 * header instead.
 */
export function cardDetails(d: IShipmentDraft, harvestLabel: (code: string) => string): ICardDetail[] {
  const rows: ICardDetail[] = [
    { key: 'blocks', value: blocksWithKg(d) },
    { key: 'date', value: d.date ? dayjs(d.date).format('DD.MM.YYYY') : '' },
    { key: 'harvest_status', value: d.harvest_status ? harvestLabel(d.harvest_status) : '' },
    { key: 'variety', value: d.variety_name ?? '' },
    { key: 'destination', value: joinFilled([d.country_name, d.city_name], ', ') },
    { key: 'customer', value: d.customer_name ?? '' },
    {
      key: 'import_firm',
      value: d.import_firm_name && d.import_firm_name !== d.customer_name ? d.import_firm_name : '',
    },
    { key: 'export_firms', value: d.export_firms_display ?? '' },
    { key: 'border_point', value: d.border_point_name ?? '' },
    { key: 'gapy', value: d.is_gapy_satys ? '✓' : '' },
    { key: 'truck', value: joinFilled([d.truck_plate, d.driver_name, d.driver_phone], ' · ') },
    { key: 'notes', value: d.notes ?? '' },
    { key: 'export_manager_note', value: d.export_manager_note ?? '' },
    {
      key: 'created',
      value: d.created_by_name
        ? `${d.created_by_name} · ${dayjs(d.created_at).format('DD.MM HH:mm')}`
        : '',
    },
  ];
  return rows.filter((r) => r.value !== '');
}
