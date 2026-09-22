import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { groupBlockFilterOptions } from './OnumcilikTab.blockFilter';
import type { IPlanGridRow } from '@/pages/export/WeeklyPlanGrid.rows';

interface IBlockFilterSelectProps {
  readonly rows: IPlanGridRow[];
  readonly value: number[] | null;
  readonly onChange: (value: number[] | null) => void;
}

/**
 * Block-row filter for the Önümçilik grid (Task 3) — an antd `Select` in
 * multiple mode rather than sera's own chip-wall `MultiSelector`
 * (App.jsx:2384): the owner asked for a dropdown specifically, and `Select`
 * already gives search-as-you-type (`optionFilterProp`), a built-in clear
 * affordance, and compact collapsed tags (`maxTagCount`) for free — a
 * hand-rolled `Dropdown` + checkbox list would reimplement all three for no
 * benefit.
 *
 * Options are grouped by location (Dusak / Kaka / Owadandepe, plus a
 * no-location catch-all) via `groupBlockFilterOptions` — antd's grouped
 * option format (`{ label, options }`) renders these as `<OptGroup>`s.
 *
 * `rows` is built from the FULL block list (not the already-filtered set) so
 * a block removed from view stays pickable to bring back.
 */
export function BlockFilterSelect({ rows, value, onChange }: IBlockFilterSelectProps) {
  const { t } = useTranslation();
  const options = groupBlockFilterOptions(rows, t('plan.block_filter_no_location'));

  return (
    <Select
      mode="multiple"
      allowClear
      style={{ minWidth: 220, maxWidth: 320 }}
      placeholder={t('plan.block_select_placeholder')}
      optionFilterProp="label"
      maxTagCount="responsive"
      options={options}
      value={value ?? undefined}
      // An empty pick (every tag removed, or the clear icon) maps back to
      // `null` — "no filter, show everything" — rather than staying `[]`,
      // "filter to nothing". A filter dropdown's clear action means "show
      // me everything again", not "show me an empty table".
      onChange={(vals: number[]) => onChange(vals.length ? vals : null)}
    />
  );
}
