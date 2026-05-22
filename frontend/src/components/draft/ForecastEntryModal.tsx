import { useState, useMemo } from 'react';
import { Modal, Button, InputNumber, Segmented, Alert, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { BlockSelect } from '@/components/BlockSelect';
import { useSubmitForecast } from '@/hooks/useDrafts';
import type { IForecastSubmitEntry } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

// ─── Types ────────────────────────────────────────────────────────────────

interface IForecastRow {
  key: number;
  block_id: number | null;
  forecast_kg: number;
}

interface IForecastEntryModalProps {
  open: boolean;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeKey(): number {
  return Date.now() + Math.random();
}

function makeDefaultRow(): IForecastRow {
  return { key: makeKey(), block_id: null, forecast_kg: 0 };
}

// ─── Component ────────────────────────────────────────────────────────────

export function ForecastEntryModal({ open, onClose }: IForecastEntryModalProps) {
  const { t } = useTranslation();
  const submitForecast = useSubmitForecast();

  const today = dayjs().format('YYYY-MM-DD');
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');

  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [rows, setRows] = useState<IForecastRow[]>([makeDefaultRow()]);
  const [windowErrors, setWindowErrors] = useState<string[]>([]);

  const usedBlockIds = rows
    .map((r) => r.block_id)
    .filter((id): id is number => id !== null);

  const totalKg = useMemo(() => rows.reduce((s, r) => s + r.forecast_kg, 0), [rows]);

  // ── Row handlers ─────────────────────────────────────────────────────

  function handleAddRow() {
    setRows((prev) => [...prev, makeDefaultRow()]);
  }

  function handleRemoveRow(key: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  function handleBlockChange(key: number, blockId: number | null) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, block_id: blockId } : r)),
    );
  }

  function handleWeightChange(key: number, value: number | null) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, forecast_kg: value ?? 0 } : r)),
    );
  }

  // ── Save ──────────────────────────────────────────────────────────────

  function handleSave() {
    setWindowErrors([]);
    const validEntries: IForecastSubmitEntry[] = rows
      .filter((r) => r.block_id !== null && r.forecast_kg > 0)
      .map((r) => ({ block_id: r.block_id as number, forecast_kg: r.forecast_kg }));

    if (validEntries.length === 0) {
      toast.error(t('forecast.error_no_rows'));
      return;
    }

    submitForecast.mutate(
      { date: selectedDate, entries: validEntries },
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
            // Per-entry validation errors returned as an array
            if (Array.isArray(data.entries) && data.entries.length > 0) {
              setWindowErrors(data.entries);
              return;
            }
            // Top-level error string (e.g. forecast window closed)
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

  function handleReset() {
    setSelectedDate(today);
    setRows([makeDefaultRow()]);
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
        <Segmented
          value={selectedDate}
          onChange={(val) => setSelectedDate(val as string)}
          options={dateOptions}
        />
      </div>

      {/* Window-closed errors (e.g. forecast window closed) */}
      {windowErrors.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={windowErrors.join(' ')}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Block rows table */}
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 160px 40px',
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
          <div />
        </div>

        {/* Rows */}
        {rows.map((row) => (
          <ForecastRow
            key={row.key}
            row={row}
            excludeIds={usedBlockIds.filter((id) => id !== row.block_id)}
            onBlockChange={(id) => handleBlockChange(row.key, id)}
            onWeightChange={(v) => handleWeightChange(row.key, v)}
            onRemove={() => handleRemoveRow(row.key)}
            canRemove={rows.length > 1}
          />
        ))}

        {/* Add row */}
        <div
          onClick={handleAddRow}
          style={{
            padding: '10px 14px',
            color: COLORS.primary,
            fontSize: 13,
            cursor: 'pointer',
            borderTop: '1px solid #f0f0f0',
            textAlign: 'center',
            fontWeight: 500,
          }}
        >
          <PlusOutlined /> {t('forecast.add_block')}
        </div>

        {/* Total row */}
        {totalKg > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 160px 40px',
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
            <div />
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── ForecastRow (sub-component) ──────────────────────────────────────────

interface IForecastRowProps {
  row: IForecastRow;
  excludeIds: number[];
  onBlockChange: (blockId: number | null) => void;
  onWeightChange: (value: number | null) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ForecastRow({
  row,
  excludeIds,
  onBlockChange,
  onWeightChange,
  onRemove,
  canRemove,
}: IForecastRowProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 160px 40px',
        padding: '8px 12px',
        gap: 8,
        alignItems: 'center',
        borderTop: '1px solid #f0f0f0',
        fontSize: 13,
      }}
    >
      <BlockSelect
        value={row.block_id}
        onChange={onBlockChange}
        excludeIds={excludeIds}
        size="small"
        placeholder={t('forecast.block_ph')}
      />
      <InputNumber
        value={row.forecast_kg || null}
        onChange={onWeightChange}
        min={0}
        step={1000}
        style={{ width: '100%', textAlign: 'right' }}
        size="small"
        addonAfter="kg"
      />
      <Button
        size="small"
        type="text"
        danger
        icon={<DeleteOutlined />}
        onClick={onRemove}
        disabled={!canRemove}
      />
    </div>
  );
}
