import type { IShipmentDraft } from '@/types';
import { hasPacking, isPreLoading, type IJoinClassifiable } from '@/components/sheet/joinHelpers';

// Assignment board classification (spec 2026-09-29, Part 2). Rows come from
// useJoinBoard(): every shipment before loading.

function classify(d: IShipmentDraft): IJoinClassifiable {
  return {
    status_code: d.status_code ?? 'draft',
    country: d.country ?? null,
    customer: d.customer ?? null,
    block_sources: d.block_sources,
  };
}

/** Left column: a supply plan on no truck — draft, has packing, no full destination. */
export function isFreePacking(d: IShipmentDraft): boolean {
  const c = classify(d);
  return c.status_code === 'draft' && hasPacking(c) && !(c.country !== null && c.customer !== null);
}

/** Right column: a destination plan that has not started loading. */
export function isExportPart(d: IShipmentDraft): boolean {
  const c = classify(d);
  return c.country !== null && c.customer !== null && isPreLoading(c.status_code);
}

function isWaiting(d: IShipmentDraft): boolean {
  return isExportPart(d) && !hasPacking(classify(d));
}

function canSwap(d: IShipmentDraft): boolean {
  const c = classify(d);
  return hasPacking(c) && isPreLoading(c.status_code);
}

export function splitBoardColumns(rows: IShipmentDraft[]) {
  const exportParts = rows.filter(isExportPart);
  return {
    free: rows.filter(isFreePacking),
    waiting: exportParts.filter((d) => !hasPacking(classify(d))),
    joined: exportParts.filter((d) => hasPacking(classify(d))),
  };
}

export type BoardAction =
  | { kind: 'join'; targetId: number; sourceId: number }
  | { kind: 'unjoin'; id: number }
  | { kind: 'swap'; aId: number; bId: number }
  | { kind: 'none' };

/** The one action the picked cards allow. */
export function decideBoardAction(selected: IShipmentDraft[]): BoardAction {
  if (selected.length === 1) {
    const [only] = selected;
    return isExportPart(only) && hasPacking(classify(only)) ? { kind: 'unjoin', id: only.id } : { kind: 'none' };
  }
  if (selected.length !== 2 || selected[0].id === selected[1].id) return { kind: 'none' };
  const [a, b] = selected;
  if (isFreePacking(a) && isWaiting(b)) return { kind: 'join', targetId: b.id, sourceId: a.id };
  if (isFreePacking(b) && isWaiting(a)) return { kind: 'join', targetId: a.id, sourceId: b.id };
  if (canSwap(a) && canSwap(b)) return { kind: 'swap', aId: a.id, bId: b.id };
  return { kind: 'none' };
}

/** Click rule: toggle; with two already picked, a new card starts over. */
export function nextSelection(current: number[], clicked: number): number[] {
  if (current.includes(clicked)) return current.filter((id) => id !== clicked);
  if (current.length >= 2) return [clicked];
  return [...current, clicked];
}
