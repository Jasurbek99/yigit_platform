import { useState } from 'react';
import { Popover, Slider, Radio, ColorPicker, Button, Select } from 'antd';
import type { Color } from 'antd/es/color-picker';
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
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          {t('sheet_rows.style_color')}
        </div>
        <ColorPicker
          value={record.style_color ?? undefined}
          disabled={!canWrite}
          onChangeComplete={(color: Color) => {
            // Defensive slice: `disabledAlpha` should keep this at 7 chars,
            // but older Ant builds still emit `#RRGGBBAA`. Backend column is
            // CharField(max_length=7) — so we truncate before sending.
            const hex = color.toHexString().slice(0, 7);
            onSave({ style_color: hex });
          }}
          onClear={() => onSave({ style_color: '' })}
          format="hex"
          allowClear
          disabledAlpha
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          {t('sheet_rows.style_font_color')}
        </div>
        <ColorPicker
          value={record.style_font_color ?? undefined}
          disabled={!canWrite}
          onChangeComplete={(color: Color) => {
            const hex = color.toHexString().slice(0, 7);
            onSave({ style_font_color: hex });
          }}
          onClear={() => onSave({ style_font_color: '' })}
          format="hex"
          allowClear
          disabledAlpha
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          {t('sheet_rows.style_font_weight')}
        </div>
        <Radio.Group
          // Blank = bold (the sheet-wide default). Only an explicit 'normal' un-bolds.
          value={record.style_font_weight === 'normal' ? 'normal' : 'bold'}
          disabled={!canWrite}
          onChange={(e) => onSave({ style_font_weight: e.target.value as 'bold' | 'normal' })}
          size="small"
        >
          <Radio.Button value="bold">{t('sheet_rows.weight_bold')}</Radio.Button>
          <Radio.Button value="normal">{t('sheet_rows.weight_normal')}</Radio.Button>
        </Radio.Group>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          {t('sheet_rows.style_font_style')}
        </div>
        <Radio.Group
          value={record.style_font_style === 'italic' ? 'italic' : 'normal'}
          disabled={!canWrite}
          onChange={(e) => onSave({ style_font_style: e.target.value as 'normal' | 'italic' })}
          size="small"
        >
          <Radio.Button value="normal">{t('sheet_rows.style_normal')}</Radio.Button>
          <Radio.Button value="italic">{t('sheet_rows.style_italic')}</Radio.Button>
        </Radio.Group>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          {t('sheet_rows.style_font_family')}
        </div>
        <Select<'dm_sans' | 'inter' | 'mono' | 'serif' | ''>
          value={record.style_font_family || ''}
          disabled={!canWrite}
          onChange={(v) => onSave({ style_font_family: v })}
          size="small"
          style={{ width: '100%' }}
          options={[
            { value: '', label: t('sheet_rows.font_default') },
            { value: 'dm_sans', label: 'DM Sans' },
            { value: 'inter', label: 'Inter' },
            { value: 'mono', label: t('sheet_rows.font_mono') },
            { value: 'serif', label: t('sheet_rows.font_serif') },
          ]}
        />
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          {t('sheet_rows.style_font_size')}: {record.style_font_size ?? 11}px
        </div>
        <Slider
          min={8}
          max={28}
          // Null = inherit the sheet default (11px). The slider shows 11 as a
          // visual anchor; dragging writes an explicit value.
          value={record.style_font_size ?? 11}
          disabled={!canWrite}
          onChange={(v) => onSave({ style_font_size: v })}
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
