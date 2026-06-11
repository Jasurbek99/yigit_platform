import { useEffect, useState } from 'react';
import { Slider, Radio, ColorPicker, Select } from 'antd';
import type { Color } from 'antd/es/color-picker';
import { useTranslation } from 'react-i18next';
import type { ISaveSheetRowPayload } from '@/hooks/useSheetRowSettings';

/**
 * Flat style fields shared by the admin Sheet-Rows tab (`ISheetRowSetting`) and
 * the Sheet gear popover (mapped from `ISheetRowSettingForUser.style`). Kept as
 * a narrow interface so both call sites can pass their own record shape.
 *
 * Width + alignment columns still exist on the model/payload but are no longer
 * editable here (dropped as unusable) — so they're intentionally absent.
 */
export interface ISheetRowStyleValues {
  style_color: string | null;
  style_font_color: string | null;
  style_font_weight: 'bold' | 'normal' | '';
  style_font_style: 'normal' | 'italic' | '';
  style_font_family: 'dm_sans' | 'inter' | 'mono' | 'serif' | '';
  style_font_size: number | null;
}

interface ISheetRowStyleControlsProps {
  values: ISheetRowStyleValues;
  canWrite: boolean;
  onSave: (patch: Partial<ISaveSheetRowPayload>) => void;
}

/**
 * The per-row cell-style controls: background + font colors (one line), font
 * weight / style / family / size. Presentational — owns no state beyond the
 * font-size slider's drag mirror; every change is pushed through `onSave`.
 * Shared by `SheetRowStylePopover` (admin tab) and `SheetRowSettingsPopover`
 * (Sheet gear).
 */
export function SheetRowStyleControls({
  values,
  canWrite,
  onSave,
}: ISheetRowStyleControlsProps) {
  const { t } = useTranslation();

  // The font-size slider mirrors its value in local state so the thumb tracks
  // the drag smoothly (onChange), while the actual save fires only once on
  // release (onChangeComplete). The effect re-syncs when the saved value
  // changes (after the PATCH refetch, or when a different row's settings load).
  const [sizeLocal, setSizeLocal] = useState<number>(values.style_font_size ?? 11);
  useEffect(() => {
    setSizeLocal(values.style_font_size ?? 11);
  }, [values.style_font_size]);

  return (
    <div style={{ width: 240 }}>
      <div style={{ marginBottom: 8, display: 'flex', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
            {t('sheet_rows.style_color')}
          </div>
          <ColorPicker
            value={values.style_color ?? undefined}
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
        <div>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
            {t('sheet_rows.style_font_color')}
          </div>
          <ColorPicker
            value={values.style_font_color ?? undefined}
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
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          {t('sheet_rows.style_font_weight')}
        </div>
        <Radio.Group
          // Blank = bold (the sheet-wide default). Only an explicit 'normal' un-bolds.
          value={values.style_font_weight === 'normal' ? 'normal' : 'bold'}
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
          value={values.style_font_style === 'italic' ? 'italic' : 'normal'}
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
          value={values.style_font_family || ''}
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
          {t('sheet_rows.style_font_size')}: {sizeLocal}px
        </div>
        <Slider
          min={8}
          max={28}
          // Null = inherit the sheet default (11px). The slider shows 11 as a
          // visual anchor; dragging writes an explicit value.
          value={sizeLocal}
          disabled={!canWrite}
          // onChange = local visual only; onChangeComplete = single save (see width).
          onChange={setSizeLocal}
          onChangeComplete={(v) => onSave({ style_font_size: v })}
        />
      </div>
    </div>
  );
}
