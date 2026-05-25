import { useState, useMemo } from 'react';
import { Modal, Button, Input, Typography, DatePicker } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useCreateSupplyDraft } from '@/hooks/useDrafts';
import { VarietySelect } from '@/components/VarietySelect';
import { BlockSelect } from '@/components/BlockSelect';
import { COLORS, FONT } from '@/constants/styles';

const MAX_ROWS = 11;

// ─── Local types ──────────────────────────────────────────────────────────

interface ISupplyRow {
  key: number;
  block_id: number | null;
  weight_kg: string;
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
  excludeIds: number[];
  onBlockChange: (blockId: number | null) => void;
  onWeightChange: (weight: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function SupplyRowItem({
  row,
  excludeIds,
  onBlockChange,
  onWeightChange,
  onRemove,
  canRemove,
}: ISupplyRowItemProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 120px 36px',
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
        placeholder={t('sheet.supply_modal.block_ph')}
        style={{ width: '100%' }}
      />
      <Input
        size="small"
        type="number"
        value={row.weight_kg}
        onChange={(e) => onWeightChange(e.target.value)}
        placeholder="kg"
        suffix="kg"
        style={{ fontFamily: FONT.mono }}
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

// ─── Sub-component: truck count estimate ─────────────────────────────────

const TRUCK_CAPACITY_KG = 18_500;

interface ITruckEstimateProps {
  totalKg: number;
}

function TruckEstimate({ totalKg }: ITruckEstimateProps) {
  const { t } = useTranslation();
  const count = Math.max(1, Math.ceil(totalKg / TRUCK_CAPACITY_KG));
  return (
    <Typography.Text
      type="secondary"
      style={{ fontSize: 11, fontWeight: 400, display: 'block' }}
    >
      {t('sheet.supply_modal.truck_estimate', { count })}
    </Typography.Text>
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

  const usedBlockIds = useMemo(
    () => rows.map((r) => r.block_id).filter((id): id is number => id !== null),
    [rows],
  );

  const totalKg = useMemo(
    () => rows.reduce((acc, r) => acc + (Number(r.weight_kg) || 0), 0),
    [rows],
  );

  function handleAddRow() {
    if (rows.length < MAX_ROWS) {
      setRows((prev) => [...prev, makeRow()]);
    }
  }

  function handleRemoveRow(key: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  function handleBlockChange(key: number, blockId: number | null) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, block_id: blockId } : r)));
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
      .filter((r) => r.block_id !== null && Number(r.weight_kg) > 0)
      .map((r) => ({ block_id: r.block_id as number, weight_kg: Number(r.weight_kg) }));

    if (block_sources.length === 0) {
      toast.error(t('sheet.supply_modal.error_no_blocks'));
      return;
    }

    createDraft.mutate(
      {
        cargo_code: cargoCode.trim(),
        date: date.format('YYYY-MM-DD'),
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
            onChange={(d) => d && setDate(d)}
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
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 120px 36px',
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
          <div>{t('sheet.supply_modal.col_block')}</div>
          <div style={{ textAlign: 'right' }}>{t('sheet.supply_modal.col_weight')}</div>
          <div />
        </div>

        {rows.map((row) => (
          <SupplyRowItem
            key={row.key}
            row={row}
            excludeIds={usedBlockIds.filter((id) => id !== row.block_id)}
            onBlockChange={(blockId) => handleBlockChange(row.key, blockId)}
            onWeightChange={(weight) => handleWeightChange(row.key, weight)}
            onRemove={() => handleRemoveRow(row.key)}
            canRemove={rows.length > 1}
          />
        ))}

        {rows.length < MAX_ROWS && (
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
            gridTemplateColumns: '1fr 120px 36px',
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
            {totalKg > 0 && (
              <TruckEstimate totalKg={totalKg} />
            )}
          </div>
          <div />
        </div>
      </div>
    </Modal>
  );
}
