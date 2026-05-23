import { useState, useMemo } from 'react';
import {
  Modal,
  Button,
  Input,
  Select,
  Collapse,
  Popover,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { OfficialCodeEditor } from '@/components/draft/OfficialCodeEditor';
import { useCreateDraft, useHarvestForecastRemaining } from '@/hooks/useDrafts';
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
}

/** One pickable block from the forecast pool (code + remaining harvest). */
interface IBlockOption {
  block_id: number;
  code: string;
  remaining: number;
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
  return { key: makeKey(), block_id: null, block_code: '' };
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

  // Pool data: one call per composer open — block_id → remaining kg.
  const { data: remainingList = [] } = useHarvestForecastRemaining(today);
  const remainingMap = useMemo(
    () => new Map(remainingList.map((r) => [r.block_id, Number(r.remaining_kg)])),
    [remainingList],
  );

  // Pickable blocks (forecast pool, remaining > 0) shown as "code — remaining kg".
  const blockOptions: IBlockOption[] = useMemo(
    () =>
      remainingList
        .map((r) => ({ block_id: r.block_id, code: r.block_code, remaining: Number(r.remaining_kg) }))
        .filter((o) => o.remaining > 0)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [remainingList],
  );
  const hasPool = blockOptions.length > 0;

  // Auto-fill greedily, in row order: each block takes min(its remaining, space
  // left to fill the truck). Under-18,500 blocks empty fully; bigger blocks cap
  // at 18,500 — so the truck fills from the fewest blocks. Weights are derived,
  // never typed.
  const allocations = useMemo(() => {
    let used = 0;
    return rows.map((r) => {
      if (r.block_id === null) return 0;
      const rem = remainingMap.get(r.block_id) ?? 0;
      const take = Math.min(rem, Math.max(0, MAX_TRUCK_KG - used));
      used += take;
      return take;
    });
  }, [rows, remainingMap]);

  const totalKg = useMemo(() => allocations.reduce((s, w) => s + w, 0), [allocations]);
  const isFull = totalKg >= MAX_TRUCK_KG;

  const usedBlockIds = rows.map((r) => r.block_id).filter((id): id is number => id !== null);

  // ── Row handlers ─────────────────────────────────────────────────────

  function handleAddRow() {
    if (rows.length >= MAX_ROWS) return;
    setRows((prev) => [...prev, makeDefaultRow()]);
  }

  function handleRemoveRow(key: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  function handleBlockChange(key: number, blockId: number | null) {
    const code = blockOptions.find((o) => o.block_id === blockId)?.code ?? '';
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, block_id: blockId, block_code: code } : r)),
    );
  }

  // ── Save ──────────────────────────────────────────────────────────────

  function handleSave() {
    const block_sources = rows
      .map((r, i) => ({ block_id: r.block_id, weight_kg: allocations[i] }))
      .filter((b): b is { block_id: number; weight_kg: number } => b.block_id !== null && b.weight_kg > 0);

    if (block_sources.length === 0) {
      toast.error(t('draft.composer_error_no_rows'));
      return;
    }
    if (!cargoCode.trim()) {
      toast.error(t('draft.composer_error_no_code'));
      return;
    }
    if (totalKg < MAX_TRUCK_KG) {
      toast.error(t('draft.composer_min_truck', { kg: MAX_TRUCK_KG.toLocaleString('ru-RU') }));
      return;
    }

    createDraft.mutate(
      {
        cargo_code: cargoCode.trim(),
        date: today,
        is_draft: true,
        block_sources,
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
          disabled={totalKg < MAX_TRUCK_KG}
          onClick={handleSave}
        >
          {t('draft.composer_save')}
        </Button>,
      ]}
    >
      {/* ── Section 1: Harvest — pick blocks, the truck auto-fills ── */}
      <SectionTitle>1. {t('draft.composer_section_harvest')}</SectionTitle>

      {/* No forecast pool → nothing to draft from (forecast-first) */}
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

      {/* Block rows table */}
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 140px 40px',
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
        {rows.map((row, i) => (
          <ComposerRow
            key={row.key}
            row={row}
            allocation={allocations[i]}
            options={blockOptions}
            excludeIds={usedBlockIds.filter((id) => id !== row.block_id)}
            onBlockChange={(blockId) => handleBlockChange(row.key, blockId)}
            onRemove={() => handleRemoveRow(row.key)}
            canRemove={rows.length > 1}
          />
        ))}

        {/* Add row — only while the truck isn't full yet */}
        {rows.length < MAX_ROWS && hasPool && !isFull && (
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
            gridTemplateColumns: '1fr 140px 40px',
            padding: '10px 12px',
            gap: 8,
            fontWeight: 600,
            borderTop: `2px solid ${COLORS.border}`,
            background: COLORS.bgLayout,
          }}
        >
          <div style={{ fontSize: 12 }}>{t('draft.composer_total')}</div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontFamily: FONT.mono,
                fontSize: 14,
                color: isFull ? COLORS.success : COLORS.textPrimary,
              }}
            >
              {totalKg.toLocaleString('ru-RU')} / {MAX_TRUCK_KG.toLocaleString('ru-RU')} kg
            </div>
            {!isFull && (
              <div style={{ fontSize: 11, color: COLORS.warning, fontWeight: 400 }}>
                {t('draft.composer_need_more', {
                  kg: (MAX_TRUCK_KG - totalKg).toLocaleString('ru-RU'),
                })}
              </div>
            )}
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
  /** Auto-computed kg this block contributes to the truck (read-only). */
  allocation: number;
  options: IBlockOption[];
  excludeIds: number[];
  onBlockChange: (blockId: number | null) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ComposerRow({
  row,
  allocation,
  options,
  excludeIds,
  onBlockChange,
  onRemove,
  canRemove,
}: IComposerRowProps) {
  const { t } = useTranslation();

  // Offer blocks not used in other rows (keep this row's own pick visible).
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
        gridTemplateColumns: '1fr 140px 40px',
        padding: '8px 12px',
        gap: 8,
        alignItems: 'center',
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
      <div
        style={{
          textAlign: 'right',
          fontFamily: FONT.mono,
          fontSize: 13,
          fontWeight: 600,
          color: row.block_id !== null && allocation > 0 ? COLORS.textPrimary : COLORS.textMuted,
        }}
      >
        {row.block_id !== null ? `${allocation.toLocaleString('ru-RU')} kg` : '—'}
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
