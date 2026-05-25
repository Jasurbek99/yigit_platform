import { useState, useMemo } from 'react';
import { Modal, Button, Input, Select, Typography, DatePicker } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useCreateSupplyDraft, useHarvestForecastRemaining } from '@/hooks/useDrafts';
import { VarietySelect } from '@/components/VarietySelect';
import { COLORS, FONT } from '@/constants/styles';

const MAX_ROWS = 11;

// ─── Local types ──────────────────────────────────────────────────────────

interface ISupplyRow {
  key: number;
  block_id: number | null;
  /** kg taken from this block. Defaults to the block's full remaining harvest
   *  when picked, but the user can edit it (e.g. take less than the whole block). */
  weight_kg: string;
}

/** One pickable block from the forecast pool (code + remaining harvest). */
interface IBlockOption {
  block_id: number;
  code: string;
  remaining: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeKey(): number {
  return Date.now() + Math.random();
}

function makeRow(): ISupplyRow {
  return { key: makeKey(), block_id: null, weight_kg: '' };
}

function autoCargo(): string {
  const now = dayjs();
  const dd = now.format('DD');
  const mm = now.format('MM');
  const yy = now.format('YY');
  const seq = String(Math.floor(Math.random() * 900 + 100));
  return `${dd}${mm}${seq}/${yy}`;
}

// ─── Sub-component: single block row ─────────────────────────────────────

interface ISupplyRowItemProps {
  row: ISupplyRow;
  /** The block's full remaining harvest — shown as a hint; the kg field
   *  defaults to it but is editable. */
  available: number;
  options: IBlockOption[];
  excludeIds: number[];
  onBlockChange: (blockId: number | null) => void;
  onWeightChange: (weight: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function SupplyRowItem({
  row,
  available,
  options,
  excludeIds,
  onBlockChange,
  onWeightChange,
  onRemove,
  canRemove,
}: ISupplyRowItemProps) {
  const { t } = useTranslation();

  const selectOptions = options
    .filter((o) => o.block_id === row.block_id || !excludeIds.includes(o.block_id))
    .map((o) => ({
      value: o.block_id,
      label: `${o.code} — ${o.remaining.toLocaleString('ru-RU')} kg`,
    }));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px 36px',
        padding: '8px 12px',
        gap: 8,
        alignItems: 'start',
        borderTop: '1px solid #f0f0f0',
        fontSize: 13,
      }}
    >
      <Select
        value={row.block_id ?? undefined}
        onChange={(v) => onBlockChange(v ?? null)}
        options={selectOptions}
        showSearch
        allowClear
        size="small"
        placeholder={t('draft.composer_block_ph')}
        style={{ width: '100%' }}
        filterOption={(input, option) =>
          String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
        }
      />
      <div>
        <Input
          size="small"
          type="number"
          value={row.weight_kg}
          onChange={(e) => onWeightChange(e.target.value)}
          disabled={row.block_id === null}
          suffix="kg"
          style={{ fontFamily: FONT.mono, textAlign: 'right' }}
        />
        {row.block_id !== null && (
          <Typography.Text
            type="secondary"
            style={{ fontSize: 10, display: 'block', textAlign: 'right', marginTop: 2 }}
          >
            {t('sheet.supply_modal.avail_hint', { kg: available.toLocaleString('ru-RU') })}
          </Typography.Text>
        )}
      </div>
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

// ─── Main modal component ─────────────────────────────────────────────────

export interface ISupplyDraftModalProps {
  open: boolean;
  onClose: () => void;
}

export function SupplyDraftModal({ open, onClose }: ISupplyDraftModalProps) {
  const { t } = useTranslation();
  const createDraft = useCreateSupplyDraft();

  const [date, setDate] = useState<ReturnType<typeof dayjs>>(dayjs());
  const [cargoCode, setCargoCode] = useState<string>(autoCargo);
  const [varieties, setVarieties] = useState<number[]>([]);
  const [rows, setRows] = useState<ISupplyRow[]>([makeRow()]);

  // Fetch the forecast pool for the selected date (not locked to today).
  const dateStr = date.format('YYYY-MM-DD');
  const { data: remainingList = [] } = useHarvestForecastRemaining(dateStr);

  // block_id → full remaining kg (number).
  const remainingMap = useMemo(
    () => new Map(remainingList.map((r) => [r.block_id, Number(r.remaining_kg)])),
    [remainingList],
  );

  // Pickable blocks: remaining > 0, sorted by code.
  const blockOptions: IBlockOption[] = useMemo(
    () =>
      remainingList
        .map((r) => ({ block_id: r.block_id, code: r.block_code, remaining: Number(r.remaining_kg) }))
        .filter((o) => o.remaining > 0)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [remainingList],
  );
  const hasPool = blockOptions.length > 0;

  // Allocation = the (editable) kg entered per row. Defaults to the block's
  // full remaining harvest on pick, but the user can change it — including
  // down from a whole-block amount over 18,500.
  const allocations = useMemo(
    () => rows.map((r) => (r.block_id !== null ? Number(r.weight_kg) || 0 : 0)),
    [rows],
  );

  const totalKg = useMemo(() => allocations.reduce((s, w) => s + w, 0), [allocations]);

  const usedBlockIds = rows
    .map((r) => r.block_id)
    .filter((id): id is number => id !== null);

  // ── Handlers ──────────────────────────────────────────────────────────

  function handleDateChange(d: ReturnType<typeof dayjs> | null) {
    if (!d) return;
    setDate(d);
    // Reset rows so orphaned block picks from the old pool don't persist.
    setRows([makeRow()]);
  }

  function handleAddRow() {
    if (rows.length < MAX_ROWS) {
      setRows((prev) => [...prev, makeRow()]);
    }
  }

  function handleRemoveRow(key: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  function handleBlockChange(key: number, blockId: number | null) {
    // Default the kg to the block's full remaining harvest (whole block), but
    // leave it editable so the user can adjust it afterwards.
    const remaining = blockId !== null ? (remainingMap.get(blockId) ?? 0) : 0;
    setRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? { ...r, block_id: blockId, weight_kg: blockId !== null ? String(remaining) : '' }
          : r,
      ),
    );
  }

  function handleWeightChange(key: number, weight: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, weight_kg: weight } : r)));
  }

  function handleReset() {
    setDate(dayjs());
    setCargoCode(autoCargo());
    setVarieties([]);
    setRows([makeRow()]);
  }

  function handleClose() {
    handleReset();
    onClose();
  }

  function handleSave() {
    if (!cargoCode.trim()) {
      toast.error(t('draft.composer_error_no_code'));
      return;
    }
    const block_sources = rows
      .map((r, i) => ({ block_id: r.block_id, weight_kg: allocations[i] }))
      .filter((b): b is { block_id: number; weight_kg: number } => b.block_id !== null && b.weight_kg > 0);

    if (block_sources.length === 0) {
      toast.error(t('sheet.supply_modal.error_no_blocks'));
      return;
    }

    createDraft.mutate(
      {
        cargo_code: cargoCode.trim(),
        date: dateStr,
        is_draft: true,
        block_sources,
        skip_forecast_check: true,
        varieties: varieties.length > 0 ? varieties : undefined,
      },
      {
        onSuccess: (draft) => {
          toast.success(t('sheet.supply_modal.toast_saved', { code: draft.cargo_code }));
          handleReset();
          onClose();
        },
        onError: (err) => {
          const data = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
          if (data && typeof data === 'object' && typeof data.error === 'string' && data.error) {
            toast.error(data.error);
            return;
          }
          toast.error(t('sheet.supply_modal.toast_error'));
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={t('sheet.supply_modal.title')}
      width={600}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          {t('common.cancel')}
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={createDraft.isPending}
          onClick={handleSave}
        >
          {t('sheet.supply_modal.save')}
        </Button>,
      ]}
    >
      {/* Date + Cargo code — side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>
            {t('common.date')}
          </Typography.Text>
          <DatePicker
            value={date}
            onChange={handleDateChange}
            format="DD.MM.YYYY"
            allowClear={false}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>
            {t('sheet.supply_modal.cargo_code_label')}
          </Typography.Text>
          <Input
            value={cargoCode}
            onChange={(e) => setCargoCode(e.target.value)}
            placeholder={t('sheet.supply_modal.cargo_code_ph')}
            style={{ fontFamily: FONT.mono }}
          />
        </div>
      </div>

      {/* Varieties / product (multi-select) */}
      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>
          {t('sheet.supply_modal.varieties_label')}{' '}
          <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
            ({t('common.optional')})
          </Typography.Text>
        </Typography.Text>
        <VarietySelect
          mode="multiple"
          value={varieties}
          onChange={setVarieties}
          placeholder={t('sheet.supply_modal.varieties_ph')}
          style={{ width: '100%' }}
        />
      </div>

      {/* Block rows */}
      <Typography.Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
        {t('sheet.supply_modal.blocks_label')}
      </Typography.Text>

      {/* No forecast pool for this date */}
      {!hasPool && (
        <div
          style={{
            marginBottom: 10,
            padding: '8px 12px',
            background: COLORS.bgYellow,
            borderRadius: 6,
            fontSize: 12,
            color: '#854F0B',
          }}
        >
          {t('draft.composer_no_pool')}
        </div>
      )}

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 130px 36px',
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
          <div>{t('draft.composer_col_block')}</div>
          <div style={{ textAlign: 'right' }}>{t('sheet.supply_modal.col_weight')}</div>
          <div />
        </div>

        {rows.map((row) => (
          <SupplyRowItem
            key={row.key}
            row={row}
            available={row.block_id !== null ? (remainingMap.get(row.block_id) ?? 0) : 0}
            options={blockOptions}
            excludeIds={usedBlockIds.filter((id) => id !== row.block_id)}
            onBlockChange={(blockId) => handleBlockChange(row.key, blockId)}
            onWeightChange={(weight) => handleWeightChange(row.key, weight)}
            onRemove={() => handleRemoveRow(row.key)}
            canRemove={rows.length > 1}
          />
        ))}

        {/* Add row — show while pool exists and rows < max (no truck-full gate) */}
        {rows.length < MAX_ROWS && hasPool && (
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
            <PlusOutlined /> {t('sheet.supply_modal.add_row')}
          </div>
        )}

        {/* Total */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 130px 36px',
            padding: '10px 12px',
            gap: 8,
            fontWeight: 600,
            borderTop: `2px solid ${COLORS.border}`,
            background: COLORS.bgLayout,
          }}
        >
          <div style={{ fontSize: 12 }}>{t('draft.composer_total')}</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 13 }}>
              {totalKg.toLocaleString('ru-RU')} kg
            </div>
          </div>
          <div />
        </div>
      </div>
    </Modal>
  );
}
