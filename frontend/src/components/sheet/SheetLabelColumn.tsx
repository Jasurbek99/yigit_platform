import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IRowConfig, ISheetRowSetting } from '@/types';
import {
  COL_WIDTH_ROW_NUM,
  COL_WIDTH_WHO,
  COL_WIDTH_FIELD,
} from '@/constants/sheetRowConfig';

interface ISheetLabelRowProps {
  rowConfig: IRowConfig;
  /** z-index for the sticky-left label cells (raised in frozen-row sections). */
  stickyZIndex?: number;
  /** Row settings keyed by field_key — used to resolve triggered_label. */
  rowSettings?: Record<string, ISheetRowSetting>;
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

function SheetLabelRowInner({ rowConfig, stickyZIndex = 3, rowSettings = {} }: ISheetLabelRowProps) {
  const { t } = useTranslation();

  const borderColor = STYLE_COLORS[rowConfig.style] ?? STYLE_COLORS.base;

  // Resolve the "Who" label:
  // 1. If a trigger is configured for this row, use triggered_label (already resolved by backend).
  // 2. Otherwise fall back to translating default_who_key.
  const setting = rowSettings[rowConfig.field_key];
  const whoLabel = setting?.triggered_label
    ? setting.triggered_label         // resolved display (user name or role label) — no translate
    : t(rowConfig.default_who_key);

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

      {/* Col C: Field name */}
      <div
        className="sheet-label-col sheet-label-col--field"
        style={{
          width: COL_WIDTH_FIELD,
          position: 'sticky',
          left: COL_WIDTH_ROW_NUM + COL_WIDTH_WHO,
          zIndex: stickyZIndex,
          borderLeft: `3px solid ${borderColor}`,
          flexShrink: 0,
        }}
      >
        {t(rowConfig.label_key)}
      </div>
    </Fragment>
  );
}

export const SheetLabelRow = memo(SheetLabelRowInner);
