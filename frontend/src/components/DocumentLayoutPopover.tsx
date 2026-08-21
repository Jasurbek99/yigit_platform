import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Modal, Popover, Slider, Space, Tooltip } from 'antd';
import { IconAdjustments } from '@tabler/icons-react';
import { toast } from 'sonner';

import {
  useDocumentLayouts,
  useSaveDocumentLayout,
  type IDocumentLayout,
  type IDocumentLayoutPatch,
} from '@/hooks/useDocumentLayouts';

interface IDocumentLayoutPopoverProps {
  /** Registry key of the document being tuned, e.g. 'invoice_ru'. */
  readonly documentKey: string;
  readonly size?: 'small' | 'middle' | 'large';
}

const FONT_SCALE_MIN = 80;
const FONT_SCALE_MAX = 120;
const SPACING_MIN = 1;
const SPACING_MAX = 2;
const MARGIN_MIN = -10;
const MARGIN_MAX = 15;

// Margins barely move contract_kz: its hand-authored body table is pinned wider
// than the text area, so Word already renders it past the nominal margin. Font
// scale and line spacing are the levers that actually shorten that document.
const MARGINS_ARE_WEAK = new Set(['contract_kz']);

const DEFAULTS = {
  font_scale_pct: 100,
  line_spacing: null as string | null,
  margin_top_delta_mm: 0,
  margin_bottom_delta_mm: 0,
  margin_left_delta_mm: 0,
  margin_right_delta_mm: 0,
};

/**
 * Page-layout controls for one document type — the office's way to make a
 * contract fit one page without a developer editing the .docx and redeploying.
 *
 * Sliders mirror their value locally so the thumb tracks the drag, and save once
 * on release (`onChangeComplete`), following the Sheet row-style controls.
 * Settings are shared by everyone: the printed form of a legal document should
 * not differ between operators.
 */
export function DocumentLayoutPopover({
  documentKey,
  size = 'small',
}: IDocumentLayoutPopoverProps) {
  const { t } = useTranslation();
  const { data: layouts = [] } = useDocumentLayouts();
  const { mutateAsync: saveLayout, isPending } = useSaveDocumentLayout();

  const saved: IDocumentLayout | undefined = layouts.find(
    (row) => row.document_key === documentKey,
  );

  const [draft, setDraft] = useState(DEFAULTS);

  // Re-sync when the saved values change (after a PATCH refetch, or when the
  // popover is reused for a different document).
  useEffect(() => {
    if (!saved) return;
    setDraft({
      font_scale_pct: saved.font_scale_pct,
      line_spacing: saved.line_spacing,
      margin_top_delta_mm: saved.margin_top_delta_mm,
      margin_bottom_delta_mm: saved.margin_bottom_delta_mm,
      margin_left_delta_mm: saved.margin_left_delta_mm,
      margin_right_delta_mm: saved.margin_right_delta_mm,
    });
  }, [saved]);

  const save = async (patch: IDocumentLayoutPatch): Promise<void> => {
    try {
      await saveLayout({
        documentKey,
        patch: { ...patch, version: saved?.version },
      });
    } catch (error) {
      const conflict = error as { response?: { status?: number } };
      if (conflict.response?.status === 409) {
        Modal.confirm({
          title: t('document_layout.conflict_title'),
          content: t('document_layout.conflict_body'),
          okText: t('document_layout.conflict_reload'),
          onOk: () => saveLayout({ documentKey, patch }).then(() => undefined),
        });
        return;
      }
      toast.error(t('document_layout.save_failed'));
    }
  };

  const handleReset = (): void => {
    setDraft(DEFAULTS);
    void save(DEFAULTS);
  };

  const marginSlider = (
    field: keyof typeof DEFAULTS & `margin_${string}`,
    labelKey: string,
  ) => (
    <div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>
        {t(labelKey)}: {draft[field] > 0 ? `+${draft[field]}` : draft[field]} mm
      </div>
      <Slider
        min={MARGIN_MIN}
        max={MARGIN_MAX}
        step={1}
        value={draft[field] as number}
        onChange={(value: number) => setDraft((prev) => ({ ...prev, [field]: value }))}
        onChangeComplete={(value: number) => void save({ [field]: value })}
      />
    </div>
  );

  const content = (
    <div style={{ width: 260 }}>
      {MARGINS_ARE_WEAK.has(documentKey) && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10, fontSize: 12 }}
          message={t('document_layout.margins_weak')}
        />
      )}

      <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>
        {t('document_layout.font_scale')}: {draft.font_scale_pct}%
      </div>
      <Slider
        min={FONT_SCALE_MIN}
        max={FONT_SCALE_MAX}
        step={1}
        value={draft.font_scale_pct}
        onChange={(value: number) =>
          setDraft((prev) => ({ ...prev, font_scale_pct: value }))
        }
        onChangeComplete={(value: number) => void save({ font_scale_pct: value })}
      />

      <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>
        {t('document_layout.line_spacing')}:{' '}
        {draft.line_spacing ?? t('document_layout.line_spacing_template')}
      </div>
      <Slider
        min={SPACING_MIN}
        max={SPACING_MAX}
        step={0.05}
        value={Number(draft.line_spacing ?? 1)}
        onChange={(value: number) =>
          setDraft((prev) => ({ ...prev, line_spacing: value.toFixed(2) }))
        }
        onChangeComplete={(value: number) =>
          void save({ line_spacing: value.toFixed(2) })
        }
      />

      {marginSlider('margin_top_delta_mm', 'document_layout.margin_top')}
      {marginSlider('margin_bottom_delta_mm', 'document_layout.margin_bottom')}
      {marginSlider('margin_left_delta_mm', 'document_layout.margin_left')}
      {marginSlider('margin_right_delta_mm', 'document_layout.margin_right')}

      <Space style={{ marginTop: 8, width: '100%', justifyContent: 'space-between' }}>
        <Button size="small" onClick={handleReset} disabled={isPending}>
          {t('document_layout.reset')}
        </Button>
        {saved?.updated_by_name && (
          <span style={{ fontSize: 11, color: '#999' }}>
            {t('document_layout.updated_by', { name: saved.updated_by_name })}
          </span>
        )}
      </Space>

      <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
        {t('document_layout.shared_hint')}
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      title={t('document_layout.title')}
      trigger="click"
      placement="bottomRight"
    >
      <Tooltip title={t('document_layout.title')}>
        <Button size={size} type="text" icon={<IconAdjustments size={16} />} />
      </Tooltip>
    </Popover>
  );
}
