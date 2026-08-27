import { Badge, Button, Tag, Tooltip } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, EyeInvisibleOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ISheetRowSetting } from '@/types';
import { COLORS, FONT } from '@/constants/styles';
import { resolveRowLabel } from './rowDraft';

interface ISheetRowListItemProps {
  row: ISheetRowSetting;
  /** 1-based position in the FULL ordered list, not in the filtered view. */
  position: number;
  isFirst: boolean;
  isLast: boolean;
  selected: boolean;
  canWrite: boolean;
  /** True while a search/filter narrows the list — reorder is disabled then. */
  narrowed: boolean;
  onSelect: () => void;
  onMove: (direction: 'up' | 'down') => void;
}

/** One line of the row list: position, label, field_key and state badges. */
export function SheetRowListItem({
  row,
  position,
  isFirst,
  isLast,
  selected,
  canWrite,
  narrowed,
  onSelect,
  onMove,
}: ISheetRowListItemProps) {
  const { t, i18n } = useTranslation();
  const triggerCount = row.triggered_roles.length;

  const moveButton = (direction: 'up' | 'down') => (
    <Tooltip title={narrowed ? t('sheet_rows.reorder_disabled_hint') : t(`sheet_rows.move_${direction}`)}>
      <Button
        size="small"
        type="text"
        icon={direction === 'up' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
        disabled={!canWrite || narrowed || (direction === 'up' ? isFirst : isLast)}
        onClick={(e) => {
          e.stopPropagation();
          onMove(direction);
        }}
      />
    </Tooltip>
  );

  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        cursor: 'pointer',
        borderBottom: `1px solid ${COLORS.border}`,
        background: selected ? '#e6f4ff' : undefined,
        opacity: row.is_visible ? 1 : 0.55,
      }}
    >
      <span style={{ fontFamily: FONT.mono, fontSize: 11, color: COLORS.textSecondary, width: 24 }}>
        {position}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {resolveRowLabel(row, t, i18n.language)}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLORS.textSecondary }}>
          {row.field_key}
        </div>
      </div>
      {!row.is_visible && (
        <Tooltip title={t('sheet_rows.badge_hidden')}>
          <EyeInvisibleOutlined style={{ color: COLORS.textSecondary }} />
        </Tooltip>
      )}
      {row.is_locked && (
        <Tooltip title={t('sheet_rows.badge_locked')}>
          <LockOutlined style={{ color: COLORS.warning }} />
        </Tooltip>
      )}
      {triggerCount > 0 && (
        <Tooltip title={t('sheet_rows.badge_triggers', { count: triggerCount })}>
          <Badge count={triggerCount} color={COLORS.primary} size="small" />
        </Tooltip>
      )}
      {row.is_custom && (
        <Tag color="purple" style={{ marginInlineEnd: 0, fontSize: 10 }}>
          {t('sheet_rows.custom_badge')}
        </Tag>
      )}
      {moveButton('up')}
      {moveButton('down')}
    </div>
  );
}
