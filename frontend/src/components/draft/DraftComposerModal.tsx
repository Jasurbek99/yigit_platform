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
import { useCreateDraft } from '@/hooks/useDrafts';
import { useGreenhouseBlocks } from '@/hooks/useAdmin';
import type { IShipmentDraft } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

const TARGET_KG = 18_500;
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

  const [rows, setRows] = useState<IComposerRow[]>([makeDefaultRow()]);
  const [cargoCode, setCargoCode] = useState<string>(autoCargo);
  const [officialCode, setOfficialCode] = useState<string>('');
  const [notes, setNotes] = useState('');

  const totalKg = useMemo(() => rows.reduce((s, r) => s + r.weight_kg, 0), [rows]);
  const truckEstimate = totalKg > 0 ? Math.ceil(totalKg / TARGET_KG) : null;

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
      prev.map((r) => (r.key === key ? { ...r, block_id: blockId, block_code: blockCode } : r)),
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
        date: dayjs().format('YYYY-MM-DD'),
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
        onError: () => toast.error(t('draft.composer_toast_error')),
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

      {/* Truck capacity hint */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('draft.composer_truck_capacity')}:
        </Typography.Text>
        <span style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 600 }}>
          {TARGET_KG.toLocaleString('ru-RU')} kg
        </span>
        {truckEstimate !== null && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ({t('draft.composer_truck_estimate', { count: truckEstimate })})
          </Typography.Text>
        )}
      </div>

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
            <div style={{ fontSize: 11, color: COLORS.textSecondary }}>
              {truckEstimate !== null
                ? t('draft.composer_truck_estimate', { count: truckEstimate })
                : '—'}
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
  onBlockChange: (blockId: number | null, blockCode: string) => void;
  onWeightChange: (value: number | null) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ComposerRow({
  row,
  excludeIds,
  onBlockChange,
  onWeightChange,
  onRemove,
  canRemove,
}: IComposerRowProps) {
  const { t } = useTranslation();
  const { data: blocks = [] } = useGreenhouseBlocks();

  function handleBlockSelect(id: number | null) {
    const blk = blocks.find((b) => b.id === id);
    onBlockChange(id, blk?.code ?? '');
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '140px 1fr 40px',
        padding: '8px 12px',
        gap: 8,
        alignItems: 'center',
        borderTop: '1px solid #f0f0f0',
        fontSize: 13,
      }}
    >
      <BlockSelect
        value={row.block_id}
        onChange={handleBlockSelect}
        excludeIds={excludeIds}
        size="small"
        placeholder={t('draft.composer_block_ph')}
      />
      <InputNumber
        value={row.weight_kg || null}
        onChange={onWeightChange}
        min={0}
        step={500}
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
