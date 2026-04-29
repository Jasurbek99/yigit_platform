import { useState, useMemo } from 'react';
import {
  Modal,
  Button,
  InputNumber,
  Input,
  Form,
  Alert,
  Divider,
  Space,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { BlockSelect } from '@/components/BlockSelect';
import { OfficialCodeEditor } from '@/components/draft/OfficialCodeEditor';
import { useCreateDraft } from '@/hooks/useDrafts';
import { useGreenhouseBlocks } from '@/hooks/useAdmin';
import type { IShipmentDraft } from '@/types';

const { Text } = Typography;

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

type SumStatus = 'ok' | 'under' | 'over';

function sumStatus(total: number): SumStatus {
  if (total === TARGET_KG) return 'ok';
  const pct = Math.abs(total - TARGET_KG) / TARGET_KG;
  if (total > TARGET_KG) return pct > 0.05 ? 'over' : 'over';
  return 'under';
}

function sumColor(status: SumStatus): string {
  if (status === 'ok') return '#52c41a';
  if (status === 'over') return '#ff4d4f';
  return '#faad14';
}

function diffLabel(total: number, t: (k: string, v?: Record<string, unknown>) => string): string {
  const diff = TARGET_KG - total;
  if (diff === 0) return t('draft.composer_sum_exact');
  if (diff > 0) return t('draft.composer_sum_under', { kg: diff.toLocaleString('ru-RU') });
  return t('draft.composer_sum_over', { kg: Math.abs(diff).toLocaleString('ru-RU') });
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
  const status = sumStatus(totalKg);

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

  const pctDiff = totalKg > 0 ? ((Math.abs(totalKg - TARGET_KG) / TARGET_KG) * 100).toFixed(1) : null;

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
      {/* Official export code + platform ID */}
      <Alert
        type="info"
        showIcon
        message={t('official_code.info_banner')}
        style={{ marginBottom: 12 }}
      />

      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <Typography.Text strong>{t('official_code.title')}</Typography.Text>
          <Tag color="blue" style={{ fontFamily: 'monospace' }}>
            {t('official_code.platform_id_label')}: {cargoCode}
          </Tag>
        </div>
        <OfficialCodeEditor
          value={officialCode}
          onChange={setOfficialCode}
          platformId={cargoCode}
        />
      </div>

      {/* Target weight info */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('draft.composer_target')}:
        </Typography.Text>
        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
          {TARGET_KG.toLocaleString('ru-RU')} kg
        </span>
      </div>

      {/* Block rows table */}
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 120px 40px',
            padding: '8px 12px',
            background: '#fafafa',
            fontSize: 11,
            fontWeight: 600,
            color: '#595959',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            gap: 8,
          }}
        >
          <div>{t('draft.composer_col_block')}</div>
          <div style={{ textAlign: 'right' }}>{t('draft.composer_col_allocate')}</div>
          <div style={{ textAlign: 'right' }}>{t('draft.composer_col_leftover')}</div>
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
              color: '#1677ff',
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
            gridTemplateColumns: '140px 1fr 120px 40px',
            padding: '10px 12px',
            gap: 8,
            fontWeight: 600,
            borderTop: `2px solid ${sumColor(status)}`,
            background: status === 'ok' ? '#f6ffed' : status === 'over' ? '#fff2f0' : '#fffbe6',
          }}
        >
          <div style={{ gridColumn: '1/2', fontSize: 12 }}>{t('draft.composer_total')}</div>
          <div
            style={{
              textAlign: 'right',
              fontFamily: 'monospace',
              fontSize: 14,
              color: sumColor(status),
            }}
          >
            {totalKg.toLocaleString('ru-RU')} kg
          </div>
          <div
            style={{
              textAlign: 'right',
              fontSize: 11,
              color: sumColor(status),
            }}
          >
            {diffLabel(totalKg, t)}
          </div>
          <div />
        </div>
      </div>

      {/* Percentage badge */}
      {pctDiff && status !== 'ok' && (
        <Text
          type={status === 'over' ? 'danger' : 'warning'}
          style={{ display: 'block', marginTop: 4, fontSize: 11 }}
        >
          {pctDiff}% {t(status === 'over' ? 'draft.composer_pct_over' : 'draft.composer_pct_under')}
        </Text>
      )}

      <Divider style={{ margin: '12px 0' }} />

      {/* Notes */}
      <Form.Item label={t('draft.composer_notes_label')} style={{ margin: 0 }}>
        <Input.TextArea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('draft.composer_notes_ph')}
        />
      </Form.Item>

      {/* Sort notice */}
      <div
        style={{
          marginTop: 12,
          padding: '8px 12px',
          background: '#fffbe6',
          borderRadius: 6,
          fontSize: 12,
          color: '#854F0B',
        }}
      >
        <strong>{t('draft.composer_sort_notice_title')}</strong>{' '}
        {t('draft.composer_sort_notice_body')}
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
        gridTemplateColumns: '140px 1fr 120px 40px',
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
        max={TARGET_KG}
        step={500}
        style={{ width: '100%', textAlign: 'right' }}
        size="small"
        addonAfter="kg"
      />
      <Space style={{ justifyContent: 'flex-end' }}>
        <Text
          type={row.weight_kg > 0 ? 'success' : 'secondary'}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        >
          —
        </Text>
      </Space>
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

