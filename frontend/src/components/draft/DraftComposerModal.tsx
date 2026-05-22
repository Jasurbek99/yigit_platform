import { useState, useMemo } from 'react';
import {
  Modal,
  Button,
  InputNumber,
  Input,
  Collapse,
  Popover,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { BlockSelect } from '@/components/BlockSelect';
import { OfficialCodeEditor } from '@/components/draft/OfficialCodeEditor';
import { useCreateDraft, useHarvestForecastRemaining } from '@/hooks/useDrafts';
import { useGreenhouseBlocks } from '@/hooks/useAdmin';
import type { IShipmentDraft } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

const MAX_TRUCK_KG = 18_500;
const MAX_ROWS = 11;

// ─── Types ────────────────────────────────────────────────────────────────

interface IComposerRow {
  /** Unique stable key for React rendering */
  key: number;
  block_id: number | null;
  block_code: string;
  weight_kg: number;
}

interface IDraftComposerModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (draft: IShipmentDraft) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeKey(): number {
  return Date.now() + Math.random();
}

function makeDefaultRow(): IComposerRow {
  return { key: makeKey(), block_id: null, block_code: '', weight_kg: 0 };
}

function autoCargo(): string {
  // Backend regex is ^\d{7}/\d{2}$ — exactly 7 digits, slash, 2-digit year.
  // Format: DDMM + 3-digit sequence + /YY, e.g. 1704202/26.
  const now = dayjs();
  const dd = now.format('DD');
  const mm = now.format('MM');
  const yy = now.format('YY');
  const seq = String(Math.floor(Math.random() * 900 + 100));
  return `${dd}${mm}${seq}/${yy}`;
}

/** Consistent numbered section heading inside the composer. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography.Text strong style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>
      {children}
    </Typography.Text>
  );
}

// ─── Component ────────────────────────────────────────────────────────────

export function DraftComposerModal({ open, onClose, onSaved }: IDraftComposerModalProps) {
  const { t } = useTranslation();
  const createDraft = useCreateDraft();

  const today = dayjs().format('YYYY-MM-DD');

  const [rows, setRows] = useState<IComposerRow[]>([makeDefaultRow()]);
  const [cargoCode, setCargoCode] = useState<string>(autoCargo);
  const [officialCode, setOfficialCode] = useState<string>('');
  const [notes, setNotes] = useState('');

  // Pool data: one call per composer open, maps block_id → remaining kg
  const { data: remainingList = [] } = useHarvestForecastRemaining(today);
  const remainingMap = useMemo(
    () =>
      new Map(remainingList.map((r) => [r.block_id, Number(r.remaining_kg)])),
    [remainingList],
  );

  const totalKg = useMemo(() => rows.reduce((s, r) => s + r.weight_kg, 0), [rows]);

  const usedBlockIds = rows.map((r) => r.block_id).filter((id): id is number => id !== null);

  // ── Row handlers ─────────────────────────────────────────────────────

  function handleAddRow() {
    if (rows.length >= MAX_ROWS) return;
    setRows((prev) => [...prev, makeDefaultRow()]);
  }

  function handleRemoveRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function handleBlockChange(key: number, blockId: number | null, blockCode: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        // Clamp existing weight to the new block's cap on block change
        const newRemaining = blockId !== null ? (remainingMap.get(blockId) ?? 0) : 0;
        const cap = Math.min(newRemaining, MAX_TRUCK_KG);
        const clampedWeight = Math.min(r.weight_kg, cap);
        return { ...r, block_id: blockId, block_code: blockCode, weight_kg: clampedWeight };
      }),
    );
  }

  function handleWeightChange(key: number, value: number | null) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, weight_kg: value ?? 0 } : r)),
    );
  }

  // ── Save ──────────────────────────────────────────────────────────────

  function handleSave() {
    const validRows = rows.filter((r) => r.block_id !== null && r.weight_kg > 0);
    if (validRows.length === 0) {
      toast.error(t('draft.composer_error_no_rows'));
      return;
    }
    if (!cargoCode.trim()) {
      toast.error(t('draft.composer_error_no_code'));
      return;
    }

    createDraft.mutate(
      {
        cargo_code: cargoCode.trim(),
        date: today,
        is_draft: true,
        block_sources: validRows.map((r) => ({
          block_id: r.block_id as number,
          weight_kg: r.weight_kg,
        })),
        notes: notes.trim() || undefined,
        official_export_code: officialCode.trim() || undefined,
      },
      {
        onSuccess: (draft) => {
          toast.success(t('draft.composer_toast_saved', { code: draft.cargo_code }));
          onSaved?.(draft);
          handleReset();
          onClose();
        },
        onError: (err) => {
          // Pool violations arrive either as { block_sources: {...} } (upfront
          // serializer check) or { error: "..." } (race-safe locked re-check).
          const data = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
          if (data && typeof data === 'object') {
            if ('block_sources' in data && data.block_sources && typeof data.block_sources === 'object') {
              const messages = Object.values(data.block_sources as Record<string, string>).join(' ');
              toast.error(messages || t('draft.composer_toast_error'));
              return;
            }
            if (typeof data.error === 'string' && data.error) {
              toast.error(data.error);
              return;
            }
          }
          toast.error(t('draft.composer_toast_error'));
        },
      },
    );
  }

  function handleReset() {
    setRows([makeDefaultRow()]);
    setCargoCode(autoCargo());
    setOfficialCode('');
    setNotes('');
  }

  function handleClose() {
    handleReset();
    onClose();
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={t('draft.composer_title')}
      width={740}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          {t('draft.composer_cancel')}
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={createDraft.isPending}
          onClick={handleSave}
        >
          {t('draft.composer_save')}
        </Button>,
      ]}
    >
      {/* ── Section 1: Harvest (blocks + kg) — the primary task ── */}
      <SectionTitle>1. {t('draft.composer_section_harvest')}</SectionTitle>

      {/* Block rows table */}
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 40px',
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
          <div style={{ textAlign: 'right' }}>{t('draft.composer_col_allocate')}</div>
          <div />
        </div>

        {/* Rows */}
        {rows.map((row) => (
          <ComposerRow
            key={row.key}
            row={row}
            excludeIds={usedBlockIds.filter((id) => id !== row.block_id)}
            remainingMap={remainingMap}
            onBlockChange={(blockId, blockCode) =>
              handleBlockChange(row.key, blockId, blockCode)
            }
            onWeightChange={(v) => handleWeightChange(row.key, v)}
            onRemove={() => handleRemoveRow(row.key)}
            canRemove={rows.length > 1}
          />
        ))}

        {/* Add row */}
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
            <PlusOutlined /> {t('draft.composer_add_row')}
          </div>
        )}

        {/* Total row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 40px',
            padding: '10px 12px',
            gap: 8,
            fontWeight: 600,
            borderTop: `2px solid ${COLORS.border}`,
            background: COLORS.bgLayout,
          }}
        >
          <div style={{ fontSize: 12 }}>{t('draft.composer_total')}</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 14, color: COLORS.textPrimary }}>
              {totalKg.toLocaleString('ru-RU')} kg
            </div>
          </div>
          <div />
        </div>
      </div>

      {/* ── Section 2: Shipment Code (optional) — collapsed by default ── */}
      <Collapse
        ghost
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'code',
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  2. {t('official_code.title')}{' '}
                  <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
                    ({t('common.optional')})
                  </Typography.Text>
                </Typography.Text>
                <Popover
                  content={
                    <div style={{ maxWidth: 320, fontSize: 12, lineHeight: 1.5 }}>
                      {t('official_code.info_banner')}
                    </div>
                  }
                  placement="rightTop"
                >
                  <QuestionCircleOutlined
                    style={{ color: COLORS.textSecondary, cursor: 'help' }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popover>
                <Typography.Text
                  type="secondary"
                  style={{ fontFamily: FONT.mono, fontSize: 12, marginLeft: 'auto' }}
                >
                  {t('official_code.platform_id_label')}: {cargoCode}
                </Typography.Text>
              </div>
            ),
            children: <OfficialCodeEditor value={officialCode} onChange={setOfficialCode} />,
          },
        ]}
      />

      {/* ── Section 3: Notes (optional) ── */}
      <div style={{ marginTop: 16 }}>
        <SectionTitle>3. {t('draft.composer_section_notes')}</SectionTitle>
        <Input.TextArea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('draft.composer_notes_ph')}
        />
      </div>
    </Modal>
  );
}

// ─── ComposerRow (sub-component) ──────────────────────────────────────────

interface IComposerRowProps {
  row: IComposerRow;
  excludeIds: number[];
  remainingMap: Map<number, number>;
  onBlockChange: (blockId: number | null, blockCode: string) => void;
  onWeightChange: (value: number | null) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ComposerRow({
  row,
  excludeIds,
  remainingMap,
  onBlockChange,
  onWeightChange,
  onRemove,
  canRemove,
}: IComposerRowProps) {
  const { t } = useTranslation();
  const { data: blocks = [] } = useGreenhouseBlocks();

  // Per-row cap = min(remaining for this block, MAX_TRUCK_KG)
  // If block has no forecast entry → remaining is undefined → 0 → cap = 0 → disabled
  const remaining: number | undefined =
    row.block_id !== null ? remainingMap.get(row.block_id) : undefined;
  const hasNoForecast = row.block_id !== null && remaining === undefined;
  const effectiveRemaining = remaining ?? 0;
  const cap = Math.min(effectiveRemaining, MAX_TRUCK_KG);
  const isDisabled = row.block_id !== null && cap === 0;

  function handleBlockSelect(id: number | null) {
    const blk = blocks.find((b) => b.id === id);
    onBlockChange(id, blk?.code ?? '');
  }

  // Available label shown under the block select
  let availableNode: React.ReactNode = null;
  if (row.block_id !== null) {
    if (hasNoForecast) {
      availableNode = (
        <div style={{ fontSize: 10, color: COLORS.danger, marginTop: 2 }}>
          {t('draft.composer_no_forecast')}
        </div>
      );
    } else {
      availableNode = (
        <div style={{ fontSize: 10, color: COLORS.textSecondary, marginTop: 2 }}>
          {t('draft.composer_available_kg', {
            kg: effectiveRemaining.toLocaleString('ru-RU'),
          })}
        </div>
      );
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '140px 1fr 40px',
        padding: '8px 12px',
        gap: 8,
        alignItems: 'start',
        borderTop: '1px solid #f0f0f0',
        fontSize: 13,
      }}
    >
      <div>
        <BlockSelect
          value={row.block_id}
          onChange={handleBlockSelect}
          excludeIds={excludeIds}
          size="small"
          placeholder={t('draft.composer_block_ph')}
        />
        {availableNode}
      </div>
      <InputNumber
        value={row.weight_kg || null}
        onChange={onWeightChange}
        min={0}
        max={cap > 0 ? cap : undefined}
        step={500}
        style={{ width: '100%', textAlign: 'right' }}
        size="small"
        addonAfter="kg"
        disabled={isDisabled}
      />
      <Button
        size="small"
        type="text"
        danger
        icon={<DeleteOutlined />}
        onClick={onRemove}
        disabled={!canRemove}
        style={{ marginTop: 4 }}
      />
    </div>
  );
}
