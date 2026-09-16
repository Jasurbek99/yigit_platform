/**
 * Pure block-row filter behind the Önümçilik grid's block dropdown (Task 3).
 *
 * `selectedBlockIds === null` is the sentinel for "no filter" — every block
 * shown, the grid's default, so the page looks unchanged until someone
 * touches the dropdown.
 */
export function filterPlansByBlock<T extends { block: number }>(
  plans: T[],
  selectedBlockIds: number[] | null,
): T[] {
  if (selectedBlockIds === null) return plans;
  const selected = new Set(selectedBlockIds);
  return plans.filter((p) => selected.has(p.block));
}

/** One antd `Select` option group — a location's blocks, or the no-location catch-all. */
export interface IBlockFilterOptionGroup {
  label: string;
  options: Array<{ value: number; label: string }>;
}

/**
 * Groups the block-filter dropdown's options by `location_name` (Dusak / Kaka
 * / Owadandepe — `GreenhouseBlock.location`, now carried on `IPlanGridRow`
 * since `/core/blocks/` started returning it). Blocks with no location are
 * collected into one final group instead of being dropped or left ungrouped;
 * the caller supplies its translated label so this stays i18n-free and pure.
 *
 * Groups are ordered alphabetically by location name, with the no-location
 * group always last regardless of where its label would sort — it is a
 * catch-all, not a location, and sera's own chip groups (Dusak/Kaka/
 * Owadandepe) never had one to compare against.
 */
export function groupBlockFilterOptions(
  rows: Array<{ block: number; block_name: string; block_code: string; location_name: string | null }>,
  noLocationLabel: string,
): IBlockFilterOptionGroup[] {
  const byLocation = new Map<string, Array<{ value: number; label: string }>>();
  const noLocation: Array<{ value: number; label: string }> = [];

  for (const row of rows) {
    const option = { value: row.block, label: row.block_name || row.block_code };
    if (row.location_name) {
      const existing = byLocation.get(row.location_name);
      if (existing) existing.push(option);
      else byLocation.set(row.location_name, [option]);
    } else {
      noLocation.push(option);
    }
  }

  const groups = [...byLocation.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, options]) => ({ label, options }));

  if (noLocation.length > 0) groups.push({ label: noLocationLabel, options: noLocation });

  return groups;
}
