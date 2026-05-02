import { useState } from 'react';
import { Popover, Slider, Radio, ColorPicker, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ISheetRowSetting } from '@/types';
import type { ISaveSheetRowPayload } from '@/hooks/useSheetRowSettings';

interface ISheetRowStylePopoverProps {
  record: ISheetRowSetting;
  canWrite: boolean;
  onSave: (patch: Partial<ISaveSheetRowPayload>) => void;
}

/**
 * Inline style editor for a single SheetRowSetting row in the admin tab.
 * Width slider (50–500), align radio, color picker. All three options write
 * through the parent's debounced save — no Save button on the popover.
 *
 * Extracted from SheetRowsTab.tsx (Phase 1 reviewer note #8 — file split).
 */
export function SheetRowStylePopover({
  record,
  canWrite,
  onSave,
}: ISheetRowStylePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const content = (
    <div style={{ width: 240 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          {t('sheet_rows.style_width')}
        </div>
        <Slider
          min={50}
          max={500}
          value={record.style_width ?? 120}
          disabled={!canWrite}
          onChange={(v) => onSave({ style_width: v })}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          {t('sheet_rows.style_align')}
        </div>
        <Radio.Group
          value={record.style_align ?? 'left'}
          disabled={!canWrite}
          onChange={(e) => onSave({ style_align: e.target.value as 'left' | 'center' | 'right' })}
          size="small"
        >
          <Radio.Button value="left">{t('sheet_rows.align_left')}</Radio.Button>
          <Radio.Button value="center">{t('sheet_rows.align_center')}</Radio.Button>
          <Radio.Button value="right">{t('sheet_rows.align_right')}</Radio.Button>
        </Radio.Group>
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          {t('sheet_rows.style_color')}
        </div>
        <ColorPicker
          value={record.style_color ?? ''}
          disabled={!canWrite}
          onChange={(color) => {
            const hex = color.toHexString();
            onSave({ style_color: hex === '#000000' ? null : hex });
          }}
          format="hex"
          allowClear
        />
      </div>
    </div>
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
        {record.style_width ? `${record.style_width}px` : '—'}{' '}
        {record.style_align ? `| ${record.style_align}` : ''}{' '}
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
      </Button>
    </Popover>
  );
}
