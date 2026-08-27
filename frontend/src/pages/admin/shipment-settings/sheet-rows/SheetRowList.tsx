import { Input, Segmented } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ISheetRowSetting } from '@/types';
import { COLORS } from '@/constants/styles';
import { resolveRowLabel } from './rowDraft';
import { SheetRowListItem } from './SheetRowListItem';

export type RowFilter = 'all' | 'hidden' | 'locked' | 'triggers' | 'custom';

interface ISheetRowListProps {
  /** Full list in display_order — filtering happens here, not upstream. */
  rows: ISheetRowSetting[];
  selectedId: number | null;
  canWrite: boolean;
  search: string;
  filter: RowFilter;
  onSearchChange: (next: string) => void;
  onFilterChange: (next: RowFilter) => void;
  onSelect: (row: ISheetRowSetting) => void;
  onMove: (row: ISheetRowSetting, direction: 'up' | 'down') => void;
}

const FILTERS: RowFilter[] = ['all', 'hidden', 'locked', 'triggers', 'custom'];

function matchesFilter(row: ISheetRowSetting, filter: RowFilter): boolean {
  if (filter === 'hidden') return !row.is_visible;
  if (filter === 'locked') return row.is_locked;
  if (filter === 'triggers') return row.triggered_roles.length > 0 || row.extra_users.length > 0;
  if (filter === 'custom') return row.is_custom;
  return true;
}

/**
 * The 45 sheet rows as a scannable list: search, a filter, and badges saying
 * at a glance whether a row is hidden, locked or carries access triggers.
 * Reorder arrows are disabled while a search/filter narrows the list — the
 * reorder endpoint takes the FULL order, so moving inside a filtered view
 * would swap against a neighbour the admin cannot see.
 */
export function SheetRowList({
  rows,
  selectedId,
  canWrite,
  search,
  filter,
  onSearchChange,
  onFilterChange,
  onSelect,
  onMove,
}: ISheetRowListProps) {
  const { t, i18n } = useTranslation();
  const term = search.trim().toLowerCase();
  const narrowed = term.length > 0 || filter !== 'all';

  const visible = rows.filter((row) => {
    if (!matchesFilter(row, filter)) return false;
    if (!term) return true;
    const label = resolveRowLabel(row, t, i18n.language).toLowerCase();
    return row.field_key.toLowerCase().includes(term) || label.includes(term);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <Input.Search
        allowClear
        value={search}
        placeholder={t('sheet_rows.search_placeholder')}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <Segmented
        size="small"
        value={filter}
        onChange={(val) => onFilterChange(val as RowFilter)}
        options={FILTERS.map((key) => ({ value: key, label: t(`sheet_rows.filter_${key}`) }))}
      />
      <div style={{ flex: 1, overflowY: 'auto', border: `1px solid ${COLORS.border}` }}>
        {visible.map((row) => {
          const index = rows.indexOf(row);
          return (
            <SheetRowListItem
              key={row.id}
              row={row}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === rows.length - 1}
              selected={row.id === selectedId}
              canWrite={canWrite}
              narrowed={narrowed}
              onSelect={() => onSelect(row)}
              onMove={(direction) => onMove(row, direction)}
            />
          );
        })}
        {visible.length === 0 && (
          <div style={{ padding: 16, color: COLORS.textSecondary, fontSize: 12 }}>
            {t('sheet_rows.list_empty')}
          </div>
        )}
      </div>
    </div>
  );
}
