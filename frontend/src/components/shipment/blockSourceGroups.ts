import type { IBlockSource } from '@/types';

export interface IBlockSourceGroup {
  code: string;
  batches: IBlockSource[];
}

/**
 * Groups block_sources rows by block code. A block can appear as more than
 * one row — one per harvest batch (the day that block was picked), e.g.
 * block A picked on both the 21st and the 24th.
 *
 * Returns structure only — formatting (dates, weights, separators) is each
 * caller's own concern. `ShipmentGoodsBody` uses this to render a
 * date/weight breakdown; `TaskCardEditor` uses it just to list distinct
 * codes. Several other places in this codebase (`getCellValue.ts`,
 * `JoinActionBar.tsx`, `JoinDraftsModal.tsx`, `JoinSupplyModal.tsx`,
 * `MatchPanel.tsx`, `SupplyCard.tsx`, `DraftPool.tsx`) still list one
 * block_sources entry per row rather than per block — not switched over to
 * this, but exported so doing that later doesn't mean re-deriving grouping
 * from scratch.
 */
export function groupByBlock(blockSources: IBlockSource[]): IBlockSourceGroup[] {
  const groups = new Map<string, IBlockSource[]>();
  for (const b of blockSources) {
    const list = groups.get(b.block_code);
    if (list) list.push(b);
    else groups.set(b.block_code, [b]);
  }
  return Array.from(groups.entries()).map(([code, batches]) => ({ code, batches }));
}
