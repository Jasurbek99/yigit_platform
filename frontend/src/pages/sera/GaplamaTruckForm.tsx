import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Select, Button, InputNumber, Tag, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCreateDraft } from '@/hooks/useDrafts';
import { useUpdateTruckBlocks } from '@/hooks/useGaplama';
import { OfficialCodeEditor } from '@/components/draft/OfficialCodeEditor';
import { VarietySelect } from '@/components/VarietySelect';
import { useShipmentOptions } from '@/hooks/useAdmin';
import type { IGaplamaTruck, IBlockSource } from '@/types';

/** One loadable harvest batch for a block, as the board's `carry_in_breakdown`
 * shapes it (plus today's own plan, folded in as a same-day batch — see
 * `IRow`'s own doc comment). `available_kg` is the batch's gross remaining
 * kg, captured before the day's own consumption — see
 * `build_gaplama_board`'s docstring. */
interface IGaplamaBatch {
  harvest_date: string;
  age_days: number;
  available_kg: number;
}

interface IGaplamaTruckFormProps {
  mode: 'create' | 'edit';
  /** The day this truck is dated — the create form's own batch list and
   * default block are built against this, not against real "today"
   * (2026-09-24 fix: a truck opened after stepping the Gaplama day forward
   * must be dated the day being viewed, not the calendar's actual today). */
  today: string;
  editingTruck?: IGaplamaTruck;
  /** The editing truck's own block_sources WITH harvest_date, one row per
   * batch — sourced from the drafts endpoint (`DraftBlockSourceInlineSerializer`
   * does carry harvest_date; the board's own `trucks[].block_sources` does
   * not — see task-7-report.md). Undefined when the caller couldn't resolve
   * this truck among the drafts (edge case) — falls back to the truck's
   * block-level totals, dated the truck's own day. */
  editingTruckBatches?: IBlockSource[];
  /** Block-level net available kg (already net of every truck dated this
   * day, including — for edit mode — this one). The authoritative bound on
   * the SUM across a block's batch rows; a same-day sibling truck can have
   * drawn from a batch in a way the batch's own gross figure can't
   * attribute, so the per-batch cap alone is not enough. */
  availableByBlock: Record<number, number>;
  batchesByBlock: Record<number, IGaplamaBatch[]>;
  carryDaysByBlock: Record<number, number>;
  blocks: { id: number; code: string; label: string }[];
  truckCapacityKg: number;
  onDone: () => void;
  onCancel: () => void;
}

interface IRow {
  blockId: number;
  /** The batch's harvest day, `YYYY-MM-DD`. Today's own plan is a batch too,
   *  dated today — every kg on a truck has an origin date; there is no
   *  unattributed weight. */
  harvestDate: string;
  kg: number | null;
}

const ROW_KEY = (blockId: number, harvestDate: string): string => `${blockId}:${harvestDate}`;

/** The batch list to actually render/cap against for a block — the live
 * board batches, plus an ORPHAN entry for EVERY seeded edit row
 * (`computeOrphans` registers all of them, not only ones with no live
 * match — see its own doc comment for why). An orphan's cap is a FLOOR,
 * never a ceiling: where it shares a date with a live batch, the merged
 * cap is max(live, orphan) so kg already on the row is never flagged
 * invalid while the live cap still applies above that floor (2026-09-25 —
 * a row folded onto that day's own plan was measured against the plan
 * ALONE, ignoring carry-in it may actually represent; round 2 extended
 * this past just null-source-date rows once a saved row's date stopped
 * being null on its next edit — see `computeOrphans`). A non-colliding
 * orphan (no live batch shares its date at all, e.g. one that has since
 * expired) floors to exactly its own kg, as before: its true remaining
 * headroom is unknowable from here, so it must never show as invalid, and
 * dropping it would delete that weight on save. */
function effectiveBatches(
  blockId: number,
  props: Pick<IGaplamaTruckFormProps, 'batchesByBlock'>,
  orphans: Record<number, IGaplamaBatch[]>,
): IGaplamaBatch[] {
  const live = props.batchesByBlock[blockId] ?? [];
  const orphanList = orphans[blockId] ?? [];
  const merged = live.map((b) => {
    const collision = orphanList.find((o) => o.harvest_date === b.harvest_date);
    return collision ? { ...b, available_kg: Math.max(b.available_kg, collision.available_kg) } : b;
  });
  const extra = orphanList.filter((o) => !live.some((b) => b.harvest_date === o.harvest_date));
  return [...merged, ...extra];
}

function capFor(harvestDate: string, batches: IGaplamaBatch[]): number {
  return batches.find((b) => b.harvest_date === harvestDate)?.available_kg ?? 0;
}

function ageFor(harvestDate: string, batches: IGaplamaBatch[]): number {
  return batches.find((b) => b.harvest_date === harvestDate)?.age_days ?? 0;
}

/** Same rule the old block-level cap always used: net available_kg plus
 * this truck's OWN current block total when editing (its load is already
 * subtracted out of availableByBlock, same as everyone else's dated that
 * day — released back only for the truck being edited). This stays the
 * one authoritative bound on a block's row SUM; per-batch caps are
 * additional, tighter constraints on individual rows, not a replacement
 * for it. */
function blockCapFor(blockId: number, props: IGaplamaTruckFormProps): number {
  const base = props.availableByBlock[blockId] ?? 0;
  if (props.mode === 'edit' && props.editingTruck) {
    const own = props.editingTruck.block_sources.find((s) => s.block_id === blockId);
    return base + (own?.weight_kg ?? 0);
  }
  return base;
}

/** Batches named by a seeded edit row that the live `batchesByBlock` no
 * longer lists (Gap: the board's own trucks[] carries no harvest_date, so
 * edit mode seeds from `editingTruckBatches` instead — see that prop's doc
 * comment). Computed once, from the props the form mounted with; not
 * recomputed as `rows` changes. */
function computeOrphans(props: IGaplamaTruckFormProps): Record<number, IGaplamaBatch[]> {
  if (props.mode !== 'edit' || !props.editingTruck) return {};
  const truckDate = props.editingTruck.date;
  // Real per-batch data when resolved (drafts endpoint) carries its own
  // harvest_date per row. The degrade-to-block-level-totals fallback
  // (editingTruckBatches unresolved — see initialRowsFor) does not: it is
  // dated the truck's own day with no real per-batch attribution, which is
  // the SAME situation as an explicit null harvest_date below, so it is
  // forced through the same null-date path rather than trusting whatever
  // (unrelated) harvest_date a raw block_sources row happens to carry.
  const entries: IBlockSource[] = props.editingTruckBatches?.length
    ? props.editingTruckBatches
    : props.editingTruck.block_sources;
  const forceNullDate = !props.editingTruckBatches?.length;
  // EVERY seeded row is registered here — not only a null-source-date one —
  // and `effectiveBatches` decides whether it collides with a live batch
  // (2026-09-25, round 2). A row that started null-dated stops looking null
  // the moment it round-trips through Save: `handleSubmit` sends
  // `row.harvestDate`, which the null-date fallback already resolved to the
  // truck's own day, so the WRITTEN row carries a real, non-null
  // harvest_date. A gate that only special-cased `harvest_date == null`
  // would reopen already-fixed on the first edit and dead on the second —
  // the exact "must never show as invalid" guarantee breaking one save
  // later. Registering every row costs nothing for the common case (a row
  // safely within its live batch's cap merges to the same cap it already
  // had — see `effectiveBatches`) and only matters when a row's own kg
  // exceeds its date's live cap, whatever the reason.
  const out: Record<number, IGaplamaBatch[]> = {};
  for (const bs of entries) {
    if (bs.block_id == null) continue;
    const wasNullDate = forceNullDate || bs.harvest_date == null;
    const harvestDate = wasNullDate ? truckDate : (bs.harvest_date as string);
    const list = out[bs.block_id] ?? (out[bs.block_id] = []);
    if (list.some((b) => b.harvest_date === harvestDate)) continue;
    list.push({
      harvest_date: harvestDate,
      age_days: Math.max(0, dayjs(truckDate).diff(dayjs(harvestDate), 'day')),
      available_kg: bs.weight_kg ?? 0,
    });
  }
  return out;
}

function initialRowsFor(props: IGaplamaTruckFormProps): IRow[] {
  if (props.mode === 'edit' && props.editingTruck) {
    const seeded = props.editingTruckBatches?.length
      ? props.editingTruckBatches
        .filter((bs) => bs.block_id != null && bs.weight_kg != null)
        .map((bs) => ({
          blockId: bs.block_id as number,
          harvestDate: bs.harvest_date ?? props.editingTruck!.date,
          kg: bs.weight_kg,
        }))
      // No per-batch data resolved for this truck (e.g. it wasn't found
      // among the drafts) — degrade to its block-level totals, dated its
      // own day.
      : props.editingTruck.block_sources.map((s) => ({
        blockId: s.block_id,
        harvestDate: props.editingTruck!.date,
        kg: s.weight_kg,
      }));
    // Offer every OTHER live batch of a seeded block too (empty, kg: null) —
    // the truck may only have drawn from one date so far, but editing must
    // let the operator move kg onto a fresher batch, not just adjust the
    // one the truck already has.
    const out = [...seeded];
    for (const blockId of new Set(seeded.map((r) => r.blockId))) {
      for (const b of props.batchesByBlock[blockId] ?? []) {
        if (!out.some((r) => r.blockId === blockId && r.harvestDate === b.harvest_date)) {
          out.push({ blockId, harvestDate: b.harvest_date, kg: null });
        }
      }
    }
    return out;
  }
  // Create: start on the first block, every one of its batches on screen
  // from the start (including today's own plan) — no unattributed weight.
  const firstBlockId = props.blocks[0]?.id ?? 0;
  const batches = props.batchesByBlock[firstBlockId] ?? [];
  if (batches.length === 0) return [{ blockId: firstBlockId, harvestDate: props.today, kg: null }];
  return batches.map((b) => ({ blockId: firstBlockId, harvestDate: b.harvest_date, kg: null }));
}

export default function GaplamaTruckForm(props: IGaplamaTruckFormProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language ?? 'tk';
  const createDraft = useCreateDraft();
  const updateBlocks = useUpdateTruckBlocks();

  const [rows, setRows] = useState<IRow[]>(() => initialRowsFor(props));
  const [orphans] = useState<Record<number, IGaplamaBatch[]>>(() => computeOrphans(props));
  const [exportCode, setExportCode] = useState(props.editingTruck?.export_code ?? '');
  const [harvestStatus, setHarvestStatus] = useState<string | undefined>();
  const [variety, setVariety] = useState<number | undefined>();
  const { data: harvestStatusOptions = [] } = useShipmentOptions('harvest_status');

  const chosenBlockIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.blockId))),
    [rows],
  );

  function batchesForBlock(blockId: number): IGaplamaBatch[] {
    return effectiveBatches(blockId, props, orphans);
  }

  function rowsForBlock(blockId: number): IRow[] {
    // Oldest first, always — insertion order alone doesn't guarantee this
    // once edit-mode seeding appends OTHER live batches after the truck's
    // own (possibly newer) seeded rows.
    return rows.filter((r) => r.blockId === blockId).sort((a, b) => a.harvestDate.localeCompare(b.harvestDate));
  }

  function blockTotal(blockId: number): number {
    return rowsForBlock(blockId).reduce((s, r) => s + (r.kg ?? 0), 0);
  }

  function rowInvalid(row: IRow): boolean {
    if (!row.kg) return false;
    const batches = batchesForBlock(row.blockId);
    if (row.kg > capFor(row.harvestDate, batches)) return true;
    return blockTotal(row.blockId) > blockCapFor(row.blockId, props);
  }

  const anyExceeds = rows.some(rowInvalid);
  const totalKg = rows.reduce((s, r) => s + (r.kg ?? 0), 0);
  const hasAnyKg = totalKg > 0;
  const isPartial = totalKg > 0 && totalKg < props.truckCapacityKg;
  const submitDisabled = !hasAnyKg || anyExceeds;
  const oldestAgeDays = rows
    .filter((r) => r.kg)
    .reduce((max, r) => Math.max(max, ageFor(r.harvestDate, batchesForBlock(r.blockId))), 0);

  function upsertRow(blockId: number, harvestDate: string, kg: number | null) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.blockId === blockId && r.harvestDate === harvestDate);
      if (idx === -1) return [...prev, { blockId, harvestDate, kg }];
      return prev.map((r, i) => (i === idx ? { ...r, kg } : r));
    });
  }

  function rowsForNewBlock(blockId: number): IRow[] {
    const batches = batchesForBlock(blockId);
    return batches.length
      ? batches.map((b) => ({ blockId, harvestDate: b.harvest_date, kg: null }))
      : [{ blockId, harvestDate: props.today, kg: null }];
  }

  function addBlock() {
    const chosen = new Set(chosenBlockIds);
    const next = props.blocks.find((b) => !chosen.has(b.id));
    if (!next) return;
    setRows((prev) => [
      ...prev,
      ...rowsForNewBlock(next.id).filter(
        (nr) => !prev.some((r) => r.blockId === nr.blockId && r.harvestDate === nr.harvestDate),
      ),
    ]);
  }

  function removeBlock(blockId: number) {
    setRows((prev) => prev.filter((r) => r.blockId !== blockId));
  }

  function changeBlock(oldBlockId: number, newBlockId: number) {
    setRows((prev) => {
      const without = prev.filter((r) => r.blockId !== oldBlockId);
      return [
        ...without,
        ...rowsForNewBlock(newBlockId).filter(
          (nr) => !without.some((r) => r.blockId === nr.blockId && r.harvestDate === nr.harvestDate),
        ),
      ];
    });
  }

  async function handleSubmit() {
    const blockSources = rows
      .filter((r) => r.kg)
      .map((r) => ({ block_id: r.blockId, weight_kg: r.kg as number, harvest_date: r.harvestDate }));

    if (props.mode === 'edit' && props.editingTruck) {
      try {
        await updateBlocks.mutateAsync({ shipmentId: props.editingTruck.id, rows: blockSources });
        toast.success(t('tir_takip.gaplama.form.toast_updated'));
        props.onDone();
      } catch {
        toast.error(t('tir_takip.gaplama.form.toast_error'));
      }
      return;
    }

    // shipment_code deliberately omitted — the server auto-generates it
    // (backend/apps/export/serializers.py ShipmentCreateSerializer.shipment_code,
    // required=False).
    try {
      await createDraft.mutateAsync({
        is_draft: true,
        date: props.today,
        skip_forecast_check: true,
        block_sources: blockSources,
        weight_net: totalKg,
        export_code: exportCode || undefined,
        harvest_status: harvestStatus,
        varieties: variety ? [variety] : undefined,
      });
      toast.success(t('tir_takip.gaplama.form.toast_created'));
      props.onDone();
    } catch {
      toast.error(t('tir_takip.gaplama.form.toast_error'));
    }
  }

  function ageLabel(days: number): string {
    return days <= 0
      ? t('tir_takip.gaplama.form.batch_age_fresh')
      : t('tir_takip.gaplama.form.batch_age_days', { days });
  }

  return (
    <div className="sera-gaplama-form">
      {props.mode === 'create' && (
        <div className="sera-gaplama-form-day">{t('tir_takip.gaplama.form.day_label')}: {props.today}</div>
      )}
      <Space direction="vertical" style={{ width: '100%' }}>
        {chosenBlockIds.map((blockId) => {
          const batches = batchesForBlock(blockId);
          return (
            <div key={blockId} className="sera-gaplama-form-block">
              <div className="sera-gaplama-form-block-header">
                <Select
                  value={blockId}
                  style={{ width: 160 }}
                  onChange={(newId) => changeBlock(blockId, newId)}
                  options={props.blocks.map((b) => ({ value: b.id, label: b.label }))}
                />
                <span className="sera-gaplama-form-carry">
                  {t('tir_takip.gaplama.form.carry_window', { days: props.carryDaysByBlock[blockId] ?? 0 })}
                </span>
                {chosenBlockIds.length > 1 && (
                  <Button type="text" onClick={() => removeBlock(blockId)}>✕</Button>
                )}
              </div>
              <table className="sera-gaplama-batch-table">
                <thead>
                  <tr>
                    <th>{t('tir_takip.gaplama.form.batch_col_date')}</th>
                    <th>{t('tir_takip.gaplama.form.batch_col_age')}</th>
                    <th>{t('tir_takip.gaplama.form.batch_col_available')}</th>
                    <th>{t('tir_takip.gaplama.form.batch_col_take')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsForBlock(blockId).map((row) => {
                    const cap = capFor(row.harvestDate, batches);
                    const age = ageFor(row.harvestDate, batches);
                    const invalid = rowInvalid(row);
                    return (
                      <tr key={ROW_KEY(blockId, row.harvestDate)}>
                        <td>{row.harvestDate}</td>
                        <td><Tag className="sera-gaplama-batch-age">{ageLabel(age)}</Tag></td>
                        <td className="sera-gaplama-form-cap">{cap}</td>
                        <td>
                          <InputNumber
                            type="number"
                            aria-label={t('tir_takip.gaplama.form.kg_label')}
                            aria-invalid={invalid ? 'true' : undefined}
                            value={row.kg ?? undefined}
                            min={0}
                            status={invalid ? 'error' : undefined}
                            onChange={(kg) => upsertRow(blockId, row.harvestDate, kg ?? null)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="sera-gaplama-form-subtotal">{blockTotal(blockId)} kg</div>
            </div>
          );
        })}
        <Button onClick={addBlock} disabled={chosenBlockIds.length >= props.blocks.length}>
          {t('tir_takip.gaplama.form.add_block')}
        </Button>
      </Space>

      {props.mode === 'create' && (
        <>
          <OfficialCodeEditor value={exportCode} onChange={setExportCode} platformId={null} />
          <Select
            allowClear
            placeholder={t('tir_takip.gaplama.form.harvest_status_ph')}
            value={harvestStatus}
            onChange={setHarvestStatus}
            options={harvestStatusOptions
              .filter((o) => o.is_active)
              .map((o) => ({
                value: o.code,
                label: lang.startsWith('ru') && o.label_ru ? o.label_ru
                  : lang.startsWith('en') && o.label_en ? o.label_en : o.label_tk,
              }))}
          />
          <VarietySelect value={variety} onChange={(v) => setVariety(v ?? undefined)} />
        </>
      )}

      <div className="sera-gaplama-form-total">
        {t('tir_takip.gaplama.form.total_label')}: {totalKg} kg
        {isPartial && <Tag color="orange">{t('tir_takip.gaplama.form.partial_tag')}</Tag>}
        {hasAnyKg && (
          <span className="sera-gaplama-form-oldest">
            {t('tir_takip.gaplama.form.oldest_batch', { days: oldestAgeDays })}
          </span>
        )}
      </div>

      <Space>
        <Button type="primary" disabled={submitDisabled} onClick={handleSubmit}>
          {props.mode === 'edit'
            ? t('tir_takip.gaplama.form.save')
            : t('tir_takip.gaplama.form.open_truck')}
        </Button>
        <Button onClick={props.onCancel}>{t('tir_takip.gaplama.form.cancel')}</Button>
      </Space>
    </div>
  );
}
