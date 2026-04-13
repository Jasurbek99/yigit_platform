import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IRowConfig } from '@/types';
import {
  COL_WIDTH_ROW_NUM,
  COL_WIDTH_WHO,
  COL_WIDTH_FIELD,
  ROW_HEIGHT,
} from '@/constants/sheetRowConfig';

interface ISheetLabelRowProps {
  rowConfig: IRowConfig;
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

function SheetLabelRowInner({ rowConfig }: ISheetLabelRowProps) {
  const { t } = useTranslation();

  const borderColor = STYLE_COLORS[rowConfig.style] ?? STYLE_COLORS.base;

  return (
    <div className="sheet-label-row" style={{ height: ROW_HEIGHT, display: 'flex' }}>
      {/* Col A: Row number */}
      <div
        className="sheet-label-col sheet-label-col--num"
        style={{
          width: COL_WIDTH_ROW_NUM,
          position: 'sticky',
          left: 0,
          zIndex: 3,
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
          zIndex: 3,
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
          zIndex: 3,
          borderLeft: `3px solid ${borderColor}`,
        }}
      >
        {t(rowConfig.labelKey)}
      </div>
    </div>
  );
}

export const SheetLabelRow = memo(SheetLabelRowInner);
