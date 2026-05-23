import { useState, useMemo } from 'react';
import { Modal, Button, InputNumber, Segmented, Alert, Typography, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useGreenhouseBlocks } from '@/hooks/useAdmin';
import { useSubmitForecast, useHarvestForecastRemaining } from '@/hooks/useDrafts';
import type { IForecastSubmitEntry } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

// ─── Types ────────────────────────────────────────────────────────────────

interface IForecastEntryModalProps {
  open: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────

export function ForecastEntryModal({ open, onClose }: IForecastEntryModalProps) {
  const { t } = useTranslation();
  const submitForecast = useSubmitForecast();
  const { data: blocks = [], isLoading: blocksLoading } = useGreenhouseBlocks();

  const today = dayjs().format('YYYY-MM-DD');
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');

  const [selectedDate, setSelectedDate] = useState<string>(today);
  // block_id → kg the user has edited this session. undefined = untouched →
  // fall back to the already-saved forecast (so the modal shows what's stored).
  const [edits, setEdits] = useState<Record<number, number | null>>({});
  const [windowErrors, setWindowErrors] = useState<string[]>([]);

  // Already-saved forecast for the selected date (forecast_kg per block).
  const { data: existing = [] } = useHarvestForecastRemaining(selectedDate);
  const savedMap = useMemo(
    () => new Map(existing.map((e) => [e.block_id, Number(e.forecast_kg)])),
    [existing],
  );
  const hasSaved = existing.length > 0;

  const activeBlocks = useMemo(
    () => blocks.filter((b) => b.is_active).sort((a, b) => a.code.localeCompare(b.code)),
    [blocks],
  );

  /** Displayed value: the user's edit if they touched it, else the saved forecast. */
  function valueFor(blockId: number): number | null {
    return blockId in edits ? edits[blockId] : (savedMap.get(blockId) ?? null);
  }

  const totalKg = useMemo(
    () => activeBlocks.reduce((s, b) => s + (valueFor(b.id) ?? 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeBlocks, edits, savedMap],
  );

  function handleDateChange(val: string) {
    // Switch date → drop edits so the new date's saved forecast shows.
    setSelectedDate(val);
    setEdits({});
    setWindowErrors([]);
  }

  function handleValueChange(blockId: number, value: number | null) {
    setEdits((prev) => ({ ...prev, [blockId]: value }));
  }

  // ── Save ──────────────────────────────────────────────────────────────

  function doSubmit(entries: IForecastSubmitEntry[]) {
    setWindowErrors([]);
    submitForecast.mutate(
      { date: selectedDate, entries },
      {
        onSuccess: (result) => {
          if (result.errors && result.errors.length > 0) {
            setWindowErrors(result.errors);
          } else {
            toast.success(t('forecast.toast_saved', { saved: result.saved }));
            handleReset();
            onClose();
          }
        },
        onError: (err) => {
          const data = (
            err as { response?: { data?: { error?: string; entries?: string[] } } }
          ).response?.data;
          if (data && typeof data === 'object') {
            if (Array.isArray(data.entries) && data.entries.length > 0) {
              setWindowErrors(data.entries);
              return;
            }
            if (data.error) {
              toast.error(data.error);
              return;
            }
          }
          toast.error(t('forecast.toast_error'));
        },
      },
    );
  }

  function handleSave() {
    const filled: IForecastSubmitEntry[] = activeBlocks
      .filter((b) => (valueFor(b.id) ?? 0) > 0)
      .map((b) => ({ block_id: b.id, forecast_kg: valueFor(b.id) as number }));

    if (filled.length === 0) {
      toast.error(t('forecast.error_no_rows'));
      return;
    }

    const emptyCodes = activeBlocks
      .filter((b) => !((valueFor(b.id) ?? 0) > 0))
      .map((b) => b.code);

    if (emptyCodes.length === 0) {
      doSubmit(filled);
      return;
    }

    Modal.confirm({
      title: t('forecast.confirm_empty_title'),
      content: t('forecast.confirm_empty_body', { blocks: emptyCodes.join(', ') }),
      okText: t('forecast.confirm_empty_ok'),
      cancelText: t('forecast.btn_cancel'),
      onOk: () => doSubmit(filled),
    });
  }

  function handleReset() {
    setSelectedDate(today);
    setEdits({});
    setWindowErrors([]);
  }

  function handleClose() {
    handleReset();
    onClose();
  }

  // ── Render ────────────────────────────────────────────────────────────

  const dateOptions = [
    { label: t('forecast.date_today'), value: today },
    { label: t('forecast.date_tomorrow'), value: tomorrow },
  ];

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={t('forecast.modal_title')}
      width={640}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          {t('forecast.btn_cancel')}
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={submitForecast.isPending}
          onClick={handleSave}
        >
          {t('forecast.btn_submit')}
        </Button>,
      ]}
    >
      {/* Date toggle */}
      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong style={{ fontSize: 13, marginRight: 12 }}>
          {t('forecast.date_label')}
        </Typography.Text>
        <Segmented value={selectedDate} onChange={(v) => handleDateChange(v as string)} options={dateOptions} />
      </div>

      {/* Editing-existing hint */}
      {hasSaved && (
        <Alert type="info" showIcon message={t('forecast.editing_hint')} style={{ marginBottom: 12 }} />
      )}

      {/* Window-closed / per-entry errors */}
      {windowErrors.length > 0 && (
        <Alert type="warning" showIcon message={windowErrors.join(' ')} style={{ marginBottom: 12 }} />
      )}

      {/* All-blocks table */}
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 180px',
            padding: '8px 12px',
            background: COLORS.bgLayout,
            fontSize: 11,
            fontWeight: 600,
            color: COLORS.textTertiary,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            gap: 8,
          }}
        >
          <div>{t('forecast.col_block')}</div>
          <div style={{ textAlign: 'right' }}>{t('forecast.col_kg')}</div>
        </div>

        {blocksLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {activeBlocks.map((block) => (
              <div
                key={block.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 180px',
                  padding: '6px 12px',
                  gap: 8,
                  alignItems: 'center',
                  borderTop: '1px solid #f0f0f0',
                  fontSize: 13,
                }}
              >
                <div>
                  <span style={{ fontFamily: FONT.mono, fontWeight: 600 }}>{block.code}</span>
                  {block.name && (
                    <span style={{ color: COLORS.textSecondary, marginLeft: 8, fontSize: 12 }}>
                      {block.name}
                    </span>
                  )}
                </div>
                <InputNumber
                  value={valueFor(block.id)}
                  onChange={(v) => handleValueChange(block.id, v)}
                  min={0}
                  step={1000}
                  placeholder="—"
                  style={{ width: '100%', textAlign: 'right' }}
                  size="small"
                  addonAfter="kg"
                />
              </div>
            ))}
          </div>
        )}

        {/* Total row */}
        {totalKg > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 180px',
              padding: '10px 12px',
              gap: 8,
              fontWeight: 600,
              borderTop: `2px solid ${COLORS.border}`,
              background: COLORS.bgLayout,
            }}
          >
            <div style={{ fontSize: 12 }}>{t('forecast.total_label')}</div>
            <div style={{ textAlign: 'right', fontFamily: FONT.mono, fontSize: 14 }}>
              {totalKg.toLocaleString('ru-RU')} kg
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
