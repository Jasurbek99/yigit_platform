import type { ReactNode } from 'react';
import { Typography } from 'antd';
import { NUM_STYLE } from './BlocksTable.helpers';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface ICellGroupProps {
  label: string;
  onClick: () => void;
  onHoverChange: (isHovered: boolean) => void;
  children: ReactNode;
}

/**
 * A clickable run of cells. `display: contents` keeps the children as direct grid
 * items of the row, so the wrapper can own the click target and hover state
 * without breaking the column template shared with the header and total rows.
 */
export function CellGroup({ label, onClick, onHoverChange, children }: ICellGroupProps) {
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

interface INumProps {
  value: number;
  bg?: string;
}

export function Num({ value, bg }: INumProps) {
  return <Text style={{ ...NUM_STYLE, background: bg }}>{value.toLocaleString()}</Text>;
}

interface ISeasonBarProps {
  pct: number;
}

export function SeasonBar({ pct }: ISeasonBarProps) {
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
