import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Typography } from 'antd';
import type { IBlockTotals, IMergedBlockRow } from './BlocksTable.helpers';
import { HEADER_STYLE, NUM_STYLE, ROW_GRID } from './BlocksTable.helpers';
import { CellGroup, Num, SeasonBar } from './BlocksTableCells';
import { COLORS, FONT } from '@/constants/styles';

const { Text } = Typography;

/** Spans the four column groups, naming the time window each one covers. */
export function GroupHeaderRow() {
  const { t } = useTranslation();
  const groups = [
    { key: 'daily', label: t('boss_dashboard.production.scope_daily') },
    { key: 'monthly', label: t('boss_dashboard.production.scope_monthly') },
    { key: 'seasonal', label: t('boss_dashboard.production.scope_seasonal') },
    { key: 'export', label: t('boss_dashboard.blocks_table.group_export') },
  ];

  return (
    <div style={{ ...ROW_GRID, background: COLORS.bgLayout, padding: '6px 14px 2px' }}>
      <div />
      {groups.map(({ key, label }) => (
        <Text key={key} style={{ ...HEADER_STYLE, gridColumn: 'span 2', textAlign: 'center' }}>
          {label}
        </Text>
      ))}
      <div />
    </div>
  );
}

export function ColumnHeaderRow() {
  const { t } = useTranslation();
  const plan = t('boss_dashboard.blocks_table.col_plan');
  const actual = t('boss_dashboard.blocks_table.col_actual');
  const right = { ...HEADER_STYLE, textAlign: 'right' } as const;

  return (
    <div
      style={{
        ...ROW_GRID,
        background: COLORS.bgLayout,
        borderBottom: '1px solid #f0f0f0',
        padding: '2px 14px 6px',
      }}
    >
      <Text style={HEADER_STYLE}>{t('boss_dashboard.production.header_block')}</Text>
      {['daily', 'monthly', 'seasonal'].flatMap((group) => [
        <Text key={`${group}_plan`} style={right}>{plan}</Text>,
        <Text key={`${group}_actual`} style={right}>{actual}</Text>,
      ])}
      <Text style={right}>{t('boss_dashboard.blocks_table.col_kg')}</Text>
      <Text style={right}>{t('boss_dashboard.blocks_table.col_pct')}</Text>
      <Text style={{ ...HEADER_STYLE, paddingLeft: 12 }}>
        {t('boss_dashboard.blocks_table.col_season_pct')}
      </Text>
    </div>
  );
}

interface IBlockRowProps {
  row: IMergedBlockRow;
  onHarvestClick: () => void;
  onExportClick: () => void;
}

/**
 * One block. The harvest cells and the export cells are separate click targets —
 * they lead to different screens — so hover highlights only the group under the
 * cursor rather than the whole row.
 */
export function BlockRow({ row, onHarvestClick, onExportClick }: IBlockRowProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<'harvest' | 'export' | null>(null);
  const harvestBg = hovered === 'harvest' ? COLORS.bgLayout : undefined;
  const exportBg = hovered === 'export' ? COLORS.bgLayout : undefined;

  return (
    <div style={{ ...ROW_GRID, padding: '6px 14px', borderBottom: '1px solid #f5f5f5' }}>
      <CellGroup
        label={row.block_name || row.block_code}
        onClick={onHarvestClick}
        onHoverChange={(on) => setHovered(on ? 'harvest' : null)}
      >
        <Text
          style={{ fontSize: 12, background: harvestBg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={row.block_name || row.block_code}
        >
          {row.block_name || row.block_code}
        </Text>
        <Num value={row.daily_plan_kg} bg={harvestBg} />
        <Num value={row.daily_actual_kg} bg={harvestBg} />
        <Num value={row.monthly_plan_kg} bg={harvestBg} />
        <Num value={row.monthly_actual_kg} bg={harvestBg} />
        <Num value={row.seasonal_plan_kg} bg={harvestBg} />
        <Num value={row.seasonal_actual_kg} bg={harvestBg} />
      </CellGroup>
      <CellGroup
        label={`${row.block_code} ${t('boss_dashboard.blocks_table.group_export')}`}
        onClick={onExportClick}
        onHoverChange={(on) => setHovered(on ? 'export' : null)}
      >
        <Num value={row.export_kg} bg={exportBg} />
        <Text style={{ ...NUM_STYLE, color: COLORS.primary, background: exportBg }}>
          {row.export_pct.toFixed(1)}
        </Text>
      </CellGroup>
      {/* Its own CellGroup rather than a member of the harvest one: the bar sits
          after the export columns in grid order, so moving it inside that group
          would reorder the row. `display: contents` keeps this div the grid item,
          so wrapping changes nothing visually — it only adds the click target the
          drill-down contract already promises (docs/obsidian/screens/boss-dashboard.md
          lists the % bar among the harvest targets). */}
      <CellGroup
        label={`${row.block_name || row.block_code} ${t('boss_dashboard.blocks_table.col_season_pct')}`}
        onClick={onHarvestClick}
        onHoverChange={(on) => setHovered(on ? 'harvest' : null)}
      >
        <div style={{ paddingLeft: 12, background: harvestBg }}>
          <SeasonBar pct={row.seasonal_pct} />
        </div>
      </CellGroup>
    </div>
  );
}

interface ITotalRowProps {
  totals: IBlockTotals;
}

export function TotalRow({ totals }: ITotalRowProps) {
  const { t } = useTranslation();
  const bold = { fontSize: 12, fontWeight: 600, textAlign: 'right', fontFamily: FONT.mono } as const;
  const cells: number[] = [
    totals.daily_plan_kg,
    totals.daily_actual_kg,
    totals.monthly_plan_kg,
    totals.monthly_actual_kg,
    totals.seasonal_plan_kg,
    totals.seasonal_actual_kg,
    totals.export_kg,
  ];

  return (
    <div
      style={{
        ...ROW_GRID,
        padding: '7px 14px',
        background: COLORS.bgLight,
        borderTop: '1px solid #e8e8e8',
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: 600 }}>{t('boss_dashboard.production.total_row')}</Text>
      {cells.map((value, idx) => (
        <Text key={idx} style={bold}>{value.toLocaleString()}</Text>
      ))}
      <Text style={bold}>{totals.export_pct.toFixed(0)}</Text>
      <div style={{ paddingLeft: 12 }}>
        <SeasonBar pct={totals.seasonal_pct} />
      </div>
    </div>
  );
}
