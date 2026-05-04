import { Fragment, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LockOutlined, ArrowUpOutlined, ArrowDownOutlined, EllipsisOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import { Tooltip, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import type { IRowConfig, ISheetRowSettingForUser } from '@/types';
import {
  COL_WIDTH_ROW_NUM,
  COL_WIDTH_WHO,
  COL_WIDTH_FIELD,
} from '@/constants/sheetRowConfig';

interface ISheetLabelRowProps {
  rowConfig: IRowConfig;
  /** z-index for the sticky-left label cells (raised in frozen-row sections). */
  stickyZIndex?: number;
  /**
   * How many of the 3 label-band cells should be sticky-left (0–3).
   *  - 0: nothing sticky (all labels scroll horizontally with content)
   *  - 1: only Row # sticky
   *  - 2: Row # + Who sticky
   *  - 3: full label band sticky (default — matches the original UX)
   * Derived from the user's freeze setting in `sheetStore.frozenColCount`,
   * clamped to 3. Passed in by SheetGrid; defaults to 3 for back-compat.
   */
  labelStickyCount?: 0 | 1 | 2 | 3;
  /** Row settings keyed by field_key — used for lock icon and label override. */
  rowSettings?: Record<string, ISheetRowSettingForUser>;
  /** Current user language for label override. */
  currentUserLang?: 'tk' | 'ru' | 'en';
  /** Whether this row can be moved up (false for first row). */
  canMoveUp?: boolean;
  /** Whether this row can be moved down (false for last row). */
  canMoveDown?: boolean;
  /** Called when the user clicks Move Up. Undefined = reorder not available. */
  onMoveUp?: () => void;
  /** Called when the user clicks Move Down. Undefined = reorder not available. */
  onMoveDown?: () => void;
  /** Called when the user wants to hide this row. Undefined = hide not available. */
  onHideRow?: () => void;
  /** Phase 2b: this row's index in the visible-rows list. Required for drag drop. */
  rowIndex?: number;
  /** Phase 2b: called when this row receives a drop from another row's drag.
   * Undefined = drag-reorder not available. */
  onReorderTo?: (fromIndex: number, toIndex: number) => void;
}

const STYLE_COLORS: Record<string, string> = {
  key: '#175cd3',
  transport: '#0e7090',
  status: '#b54708',
  report: '#067647',
  separator: '#98a2b3',
  base: '#d0d5dd',
  alt: '#e4e7ec',
};

function SheetLabelRowInner({
  rowConfig,
  stickyZIndex = 3,
  labelStickyCount = 3,
  rowSettings = {},
  currentUserLang = 'tk',
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  onHideRow,
  rowIndex,
  onReorderTo,
}: ISheetLabelRowProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const borderColor = STYLE_COLORS[rowConfig.style] ?? STYLE_COLORS.base;

  const setting = rowSettings[rowConfig.field_key];

  // Resolve the "Who" label: admin-set DB override first, then default_who_key i18n.
  const dbWho = setting?.who?.[currentUserLang];
  const whoLabel = dbWho ?? t(rowConfig.default_who_key);

  // Resolve field label: DB label → i18n fallback → raw field_key
  const dbLabel = setting?.labels?.[currentUserLang];
  const fieldLabel = dbLabel ?? t(rowConfig.label_key);

  // Lock icon: row is locked and current user cannot edit it
  const isLocked = setting?.is_locked === true && setting?.can_current_user_edit === false;

  // Reorder controls are shown only when callbacks are provided
  const hasReorder = onMoveUp !== undefined && onMoveDown !== undefined;
  const hasHide = onHideRow !== undefined;

  // Phase 2b: drag-reorder. Available when both rowIndex and onReorderTo are
  // supplied AND this row participates in user-side ordering. Falls back to
  // the Up/Down arrows for keyboard / a11y users — both code paths converge
  // on the same parent helpers in SheetGrid.
  const hasDrag = onReorderTo !== undefined && typeof rowIndex === 'number';

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDrag) return;
    e.dataTransfer.setData('text/plain', String(rowIndex));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragOver) setDragOver(true);
  };

  const handleDragLeave = (): void => {
    if (dragOver) setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDrag || rowIndex === undefined) return;
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData('text/plain');
    const fromIndex = Number.parseInt(raw, 10);
    if (Number.isNaN(fromIndex) || fromIndex === rowIndex) return;
    onReorderTo?.(fromIndex, rowIndex);
  };

  // Kebab menu items
  const kebabItems: MenuProps['items'] = [];
  if (hasHide) {
    kebabItems.push({
      key: 'hide',
      icon: <EyeInvisibleOutlined />,
      label: t('sheet.hide_row'),
      onClick: () => {
        setMenuOpen(false);
        onHideRow();
      },
    });
  }

  // Rendered as a Fragment (not a wrapping div) so the 3 sticky-left cells
  // become direct flex children of the parent row. Wrapping them breaks
  // sticky positioning (the containing block becomes the wrapper's right edge).
  return (
    <Fragment>
      {/* Col A: Row number — drag handle (Phase 2b) + Up/Down a11y arrows */}
      <div
        className="sheet-label-col sheet-label-col--num"
        draggable={hasDrag}
        onDragStart={hasDrag ? handleDragStart : undefined}
        onDragOver={hasDrag ? handleDragOver : undefined}
        onDragLeave={hasDrag ? handleDragLeave : undefined}
        onDrop={hasDrag ? handleDrop : undefined}
        title={hasDrag ? t('sheet.drag_to_reorder') : undefined}
        style={{
          width: COL_WIDTH_ROW_NUM,
          ...(labelStickyCount >= 1
            ? { position: 'sticky' as const, left: 0, zIndex: stickyZIndex }
            : null),
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          cursor: hasDrag ? 'grab' : undefined,
          // Drop indicator: a 2px blue line on the top edge when another row
          // is being dragged over this one. Cheap, clear, no animation.
          boxShadow: dragOver ? 'inset 0 2px 0 0 #1677ff' : undefined,
        }}
      >
        {hasReorder ? (
          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}
            className="sheet-row-reorder"
          >
            <Tooltip title={t('sheet.move_up')} mouseEnterDelay={0.5}>
              <button
                className="sheet-reorder-btn"
                disabled={!canMoveUp}
                onClick={canMoveUp ? onMoveUp : undefined}
                aria-label={t('sheet.move_up')}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: canMoveUp ? 'pointer' : 'default',
                  padding: '1px 2px',
                  lineHeight: 1,
                  color: canMoveUp ? '#595959' : '#d9d9d9',
                  fontSize: 8,
                }}
              >
                <ArrowUpOutlined />
              </button>
            </Tooltip>
            <span style={{ fontSize: 9, color: '#8c8c8c', lineHeight: 1 }}>
              {rowConfig.row_number}
            </span>
            <Tooltip title={t('sheet.move_down')} mouseEnterDelay={0.5}>
              <button
                className="sheet-reorder-btn"
                disabled={!canMoveDown}
                onClick={canMoveDown ? onMoveDown : undefined}
                aria-label={t('sheet.move_down')}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: canMoveDown ? 'pointer' : 'default',
                  padding: '1px 2px',
                  lineHeight: 1,
                  color: canMoveDown ? '#595959' : '#d9d9d9',
                  fontSize: 8,
                }}
              >
                <ArrowDownOutlined />
              </button>
            </Tooltip>
          </div>
        ) : (
          rowConfig.row_number
        )}
      </div>

      {/* Col B: Who */}
      <div
        className="sheet-label-col sheet-label-col--who"
        style={{
          width: COL_WIDTH_WHO,
          ...(labelStickyCount >= 2
            ? { position: 'sticky' as const, left: COL_WIDTH_ROW_NUM, zIndex: stickyZIndex }
            : null),
          flexShrink: 0,
        }}
      >
        {whoLabel}
      </div>

      {/* Col C: Field name (with optional lock icon + kebab menu) */}
      <div
        className="sheet-label-col sheet-label-col--field"
        style={{
          width: COL_WIDTH_FIELD,
          ...(labelStickyCount >= 3
            ? {
                position: 'sticky' as const,
                left: COL_WIDTH_ROW_NUM + COL_WIDTH_WHO,
                zIndex: stickyZIndex,
              }
            : null),
          borderLeft: `3px solid ${borderColor}`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {fieldLabel}
        </span>
        {isLocked && (
          <Tooltip title={t('sheet_rows.locked_row')}>
            <LockOutlined style={{ fontSize: 11, color: '#8c8c8c', flexShrink: 0 }} />
          </Tooltip>
        )}
        {kebabItems.length > 0 && (
          <Dropdown
            menu={{ items: kebabItems }}
            trigger={['click']}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            placement="bottomRight"
          >
            <button
              className="sheet-row-kebab"
              aria-label={t('sheet.row_menu')}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                padding: '2px 3px',
                lineHeight: 1,
                color: '#8c8c8c',
                fontSize: 12,
                flexShrink: 0,
                borderRadius: 2,
              }}
            >
              <EllipsisOutlined />
            </button>
          </Dropdown>
        )}
      </div>
    </Fragment>
  );
}

export const SheetLabelRow = memo(SheetLabelRowInner);
