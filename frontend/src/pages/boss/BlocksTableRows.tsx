import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Typography } from 'antd';
import type { IBlockTotals, IMergedBlockRow } from './BlocksTable.helpers';
import { GRID_TEMPLATE } from './BlocksTable.helpers';
import { COLORS, FONT } from '@/constants/styles';

const { Text } = Typography;

const HEADER_STYLE = { fontSize: 11, color: COLORS.textTertiary, fontWeight: 600 } as const;
const NUM_STYLE = { fontSize: 12, textAlign: 'right', fontFamily: FONT.mono } as const;
const ROW_GRID = { display: 'grid', gridTemplateColumns: GRID_TEMPLATE } as const;

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
      <Text style={right}>%</Text>
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
        <Text style={{ fontSize: 12, background: harvestBg }}>{row.block_name || row.block_code}</Text>
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
      <div style={{ paddingLeft: 12 }}>
        <SeasonBar pct={row.seasonal_pct} />
      </div>
    </div>
  );
}

/**
 * A clickable run of cells. `display: contents` keeps the children as direct grid
 * items of the row, so the wrapper can own the click target and hover state
 * without breaking the column template shared with the header and total rows.
 */
function CellGroup({
  label,
  onClick,
  onHoverChange,
  children,
}: {
  label: string;
  onClick: () => void;
  onHoverChange: (isHovered: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      style={{ display: 'contents', cursor: 'pointer' }}
    >
      {children}
    </div>
  );
}

function Num({ value, bg }: { value: number; bg?: string }) {
  return <Text style={{ ...NUM_STYLE, background: bg }}>{value.toLocaleString()}</Text>;
}

function SeasonBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? COLORS.success : pct >= 70 ? COLORS.orange : COLORS.danger;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, background: '#e8e8e8', borderRadius: 2, height: 6 }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, background: color, height: 6, borderRadius: 2 }} />
      </div>
      <Text style={{ fontSize: 10, color: COLORS.textTertiary, minWidth: 30, textAlign: 'right' }}>
        {pct.toFixed(0)}%
      </Text>
    </div>
  );
}

export function TotalRow({ totals }: { totals: IBlockTotals }) {
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
