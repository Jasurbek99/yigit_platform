import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The separator row that heads one role block in the Sheet.
 *
 * Purely presentational — SheetGrid decides where a band goes (see
 * `sheetRoleBlocks.markRoleBands`) and what it costs in height (`bandHeight`).
 * The label sits in the sticky-left frozen band so it stays readable while the
 * shipment columns scroll; the fill div carries the tint across the full grid
 * width so the block reads as one horizontal stripe.
 */
interface ISheetRoleBandRowProps {
  /** i18n key from `IRoleBand.labelKey` — `roles.<code>` for a resolved role,
   * or a raw who-key fallback (`sheet.who.<name>`) for an unmapped owner. */
  labelKey: string;
  /** Rows this block covers — shown next to the name. */
  rowCount: number;
  /** Zoom-scaled band height, from `bandHeight(rowHeight)`. */
  height: number;
  /** Width of the sticky-left label band (Row # + Who + Field name). */
  labelWidth: number;
  /** Width of the data area (frozen shipment columns + virtualized columns). */
  fillWidth: number;
  /** True when the current user may edit at least one row in this block. */
  isMine: boolean;
}

function SheetRoleBandRowInner({
  labelKey,
  rowCount,
  height,
  labelWidth,
  fillWidth,
  isMine,
}: ISheetRoleBandRowProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`sheet-role-band${isMine ? ' sheet-role-band--mine' : ''}`}
      style={{ height }}
      role="separator"
      aria-label={t(labelKey)}
    >
      <div className="sheet-role-band__label" style={{ width: labelWidth, height }}>
        <span className="sheet-role-band__name">{t(labelKey)}</span>
        <span className="sheet-role-band__count">{rowCount}</span>
        {isMine && (
          <span className="sheet-role-band__mine">{t('sheet.role_block.mine')}</span>
        )}
      </div>
      <div className="sheet-role-band__fill" style={{ width: fillWidth, height }} />
    </div>
  );
}

export const SheetRoleBandRow = memo(SheetRoleBandRowInner);
