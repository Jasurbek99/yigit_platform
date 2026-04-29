import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IRowConfig } from '@/types';
import {
  COL_WIDTH_ROW_NUM,
  COL_WIDTH_WHO,
  COL_WIDTH_FIELD,
} from '@/constants/sheetRowConfig';

interface ISheetLabelRowProps {
  rowConfig: IRowConfig;
  /** z-index for the sticky-left label cells (raised in frozen-row sections). */
  stickyZIndex?: number;
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

function SheetLabelRowInner({ rowConfig, stickyZIndex = 3 }: ISheetLabelRowProps) {
  const { t } = useTranslation();

  const borderColor = STYLE_COLORS[rowConfig.style] ?? STYLE_COLORS.base;

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
        {rowConfig.rowNumber}
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
        {t(rowConfig.whoKey)}
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
        {t(rowConfig.labelKey)}
      </div>
    </Fragment>
  );
}

export const SheetLabelRow = memo(SheetLabelRowInner);
