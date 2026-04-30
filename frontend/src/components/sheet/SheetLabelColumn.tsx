import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { LockOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
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
  /** Row settings keyed by field_key — used for lock icon and label override. */
  rowSettings?: Record<string, ISheetRowSettingForUser>;
  /** Current user language for label override. */
  currentUserLang?: 'tk' | 'ru' | 'en';
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
  rowSettings = {},
  currentUserLang = 'tk',
}: ISheetLabelRowProps) {
  const { t } = useTranslation();

  const borderColor = STYLE_COLORS[rowConfig.style] ?? STYLE_COLORS.base;

  const setting = rowSettings[rowConfig.field_key];

  // Resolve the "Who" label (default_who_key fallback only — the v2 payload
  // no longer provides a resolved triggered_label).
  const whoLabel = t(rowConfig.default_who_key);

  // Resolve field label: DB label → i18n fallback → raw field_key
  const dbLabel = setting?.labels?.[currentUserLang];
  const fieldLabel = dbLabel ?? t(rowConfig.label_key);

  // Lock icon: row is locked and current user cannot edit it
  const isLocked = setting?.is_locked === true && setting?.can_current_user_edit === false;

  // Rendered as a Fragment (not a wrapping div) so the 3 sticky-left cells
  // become direct flex children of the parent row. If we wrap them in their
  // own flex container, the cells' sticky containing block is the 358px-wide
  // wrapper — they unstick the moment the user scrolls past ~330px because
  // the wrapper's right edge passes the viewport's left edge. As direct
  // children of the (very wide) row they stay sticky for the full scroll.
  return (
    <Fragment>
      {/* Col A: Row number */}
      <div
        className="sheet-label-col sheet-label-col--num"
        style={{
          width: COL_WIDTH_ROW_NUM,
          position: 'sticky',
          left: 0,
          zIndex: stickyZIndex,
          flexShrink: 0,
        }}
      >
        {rowConfig.row_number}
      </div>

      {/* Col B: Who */}
      <div
        className="sheet-label-col sheet-label-col--who"
        style={{
          width: COL_WIDTH_WHO,
          position: 'sticky',
          left: COL_WIDTH_ROW_NUM,
          zIndex: stickyZIndex,
          flexShrink: 0,
        }}
      >
        {whoLabel}
      </div>

      {/* Col C: Field name (with optional lock icon) */}
      <div
        className="sheet-label-col sheet-label-col--field"
        style={{
          width: COL_WIDTH_FIELD,
          position: 'sticky',
          left: COL_WIDTH_ROW_NUM + COL_WIDTH_WHO,
          zIndex: stickyZIndex,
          borderLeft: `3px solid ${borderColor}`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fieldLabel}
        </span>
        {isLocked && (
          <Tooltip title={t('sheet_rows.locked_row')}>
            <LockOutlined style={{ fontSize: 11, color: '#8c8c8c', flexShrink: 0 }} />
          </Tooltip>
        )}
      </div>
    </Fragment>
  );
}

export const SheetLabelRow = memo(SheetLabelRowInner);
