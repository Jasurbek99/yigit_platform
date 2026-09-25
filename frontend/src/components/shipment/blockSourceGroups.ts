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

/**
 * `Array.prototype.sort` comparator: orders a block's batches oldest-first
 * by `harvest_date`, with a null date sorting last. Exported (rather than
 * kept as a private inline sort callback) for two reasons: any caller that
 * needs date-ordered batches — not just distinct codes — can reuse it next
 * to `groupByBlock` instead of re-deriving it, and it can be unit-tested by
 * calling it directly with two batches and asserting the returned number.
 * That second point isn't decorative: a 2-element `Array.sort` does not
 * reliably invoke its comparator in both argument orders (V8 doesn't for a
 * pair), so a comparator that breaks antisymmetry on a tie (e.g. returning
 * `1` instead of `0` when both dates are null) can pass a "sort it and
 * check the rendered order" test even when broken — that happened here.
 */
export function compareBatchesByHarvestDate(a: IBlockSource, b: IBlockSource): number {
  if (a.harvest_date == null && b.harvest_date == null) return 0;
  if (a.harvest_date == null) return 1;
  if (b.harvest_date == null) return -1;
  return a.harvest_date < b.harvest_date ? -1 : a.harvest_date > b.harvest_date ? 1 : 0;
}
