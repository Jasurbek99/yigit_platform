import { useState } from 'react';
import { Popover, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ISheetRowSetting } from '@/types';
import type { ISaveSheetRowPayload } from '@/hooks/useSheetRowSettings';
import { SheetRowStyleControls } from '@/components/sheet/SheetRowStyleControls';

interface ISheetRowStylePopoverProps {
  record: ISheetRowSetting;
  canWrite: boolean;
  onSave: (patch: Partial<ISaveSheetRowPayload>) => void;
}

/**
 * Inline style editor for a single SheetRowSetting row in the admin tab.
 * Renders the shared `SheetRowStyleControls` (width / align / colors / font
 * weight / style / family / size) behind a text-button trigger. All options
 * write through the parent's save — no Save button on the popover.
 *
 * Extracted from SheetRowsTab.tsx (Phase 1 reviewer note #8 — file split).
 * The controls are shared verbatim with the Sheet's gear popover
 * (`SheetRowSettingsPopover`) so both surfaces stay in lockstep.
 */
export function SheetRowStylePopover({
  record,
  canWrite,
  onSave,
}: ISheetRowStylePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const content = (
    <SheetRowStyleControls values={record} canWrite={canWrite} onSave={onSave} />
  );

  return (
    <Popover
      content={content}
      title={t('sheet_rows.col_style')}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
    >
      <Button size="small" type="text">
        {t('sheet_rows.col_style')}{' '}
        {record.style_color ? (
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              background: record.style_color,
              borderRadius: 2,
              marginLeft: 4,
            }}
          />
        ) : null}
        {record.style_font_color ? (
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              background: record.style_font_color,
              borderRadius: 2,
              border: '1px solid rgba(0,0,0,0.15)',
              marginLeft: 2,
            }}
            title="Cell font color"
          />
        ) : null}
      </Button>
    </Popover>
  );
}
