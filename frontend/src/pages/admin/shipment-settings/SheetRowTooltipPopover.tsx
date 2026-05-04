import { useState } from 'react';
import { Popover, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ISheetRowSetting } from '@/types';
import type { ISaveSheetRowPayload } from '@/hooks/useSheetRowSettings';
import { InlineSavedInput } from './InlineSavedInput';

interface ISheetRowTooltipPopoverProps {
  record: ISheetRowSetting;
  canWrite: boolean;
  onSave: (patch: Partial<ISaveSheetRowPayload>) => void;
}

/**
 * Inline editor for the three-language tooltip (description_tk/_ru/_en) on
 * a single SheetRowSetting row in the admin tab. Each language is a small
 * TextArea that saves on blur via InlineSavedInput — no per-keystroke PATCH.
 *
 * Extracted from SheetRowsTab.tsx (Phase 1 reviewer note #8 — file split).
 */
export function SheetRowTooltipPopover({
  record,
  canWrite,
  onSave,
}: ISheetRowTooltipPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const content = (
    <div style={{ width: 260 }}>
      {(['tk', 'ru', 'en'] as const).map((lang) => {
        const field = `description_${lang}` as keyof ISheetRowSetting;
        return (
          <div key={lang} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
              {lang.toUpperCase()}
            </div>
            <InlineSavedInput
              multiline
              rows={2}
              value={(record[field] as string) ?? ''}
              disabled={!canWrite}
              onSave={(next) => onSave({ [field]: next } as Partial<ISaveSheetRowPayload>)}
            />
          </div>
        );
      })}
    </div>
  );

  const hasTooltip = record.description_tk || record.description_ru || record.description_en;

  return (
    <Popover
      content={content}
      title={t('sheet_rows.col_tooltip')}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
    >
      <Button size="small" type="text">
        {hasTooltip ? (
          <span style={{ color: '#1677ff' }}>{t('sheet_rows.tooltip_set')}</span>
        ) : (
          <span style={{ color: '#aaa' }}>{t('sheet_rows.tooltip_empty')}</span>
        )}
      </Button>
    </Popover>
  );
}
