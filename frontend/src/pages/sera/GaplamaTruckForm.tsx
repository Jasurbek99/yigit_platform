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
import type { IGaplamaFormBatch } from './GaplamaTab.totals';
import type { IGaplamaTruck, IBlockSource } from '@/types';

/** One loadable batch for a block — at most two exist per block/day (2026-09-25,
 * per-date leftover picking removed): today's own plan (a real date, age 0)
 * or the block's collapsed leftover (`harvest_date: null` — every live
 * carry-in bucket summed into one figure, since the loading/packaging hall
 * physically mixes carried-over crates and nobody can pick "the 21.09
 * batch" from a mix — owner + loading/packaging head). Imported from
 * `GaplamaTab.totals.ts` — that is also the shape `buildBlockBatches` (the
 * real caller's own board→batch transform) produces, so the two can never
 * silently drift apart. `available_kg` is the batch's gross remaining kg,
 * captured before the day's own consumption — see `build_gaplama_board`'s
 * docstring. */
type IGaplamaBatch = IGaplamaFormBatch;

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
  /** Which of the block's (at most two) batches this row is: today's own
   *  picking, a real `YYYY-MM-DD` date, age 0 — or the block's collapsed
   *  leftover, `null`, standing for every live carry-in bucket at once
   *  (2026-09-25, per-date leftover picking removed). */
  harvestDate: string | null;
  kg: number | null;
}

const ROW_KEY = (blockId: number, harvestDate: string | null): string => `${blockId}:${harvestDate}`;

/** Sort order for a block's rows — the leftover row (`null`, potentially the
 * oldest stock in the building) first, today's own dated row after —
 * consistent with the app-wide "oldest first" carry-over convention. */
function compareBatchDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b);
}

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
 * dropping it would delete that weight on save. **Age on a collision is
 * also the OLDER of the two (2026-09-25 fix), not just the live bucket's**
 * — the merge's whole point is that "up to N days" is an upper bound on
 * what the row actually carries; keeping only the live bucket's (fresher)
 * age would understate a leftover row seeded from real kg picked well
 * before that bucket's own origin day. */
// Exported (only) for a direct unit test on the age-precedence fix — the
// component's t-mocked render tests can't distinguish rendered ages from
// each other (the shared i18n mock swallows interpolation args), so pinning
// "keep the older of the two" needs to call this directly.
export function effectiveBatches(
  blockId: number,
  props: Pick<IGaplamaTruckFormProps, 'batchesByBlock'>,
  orphans: Record<number, IGaplamaBatch[]>,
): IGaplamaBatch[] {
  const live = props.batchesByBlock[blockId] ?? [];
  const orphanList = orphans[blockId] ?? [];
  const merged = live.map((b) => {
    const collision = orphanList.find((o) => o.harvest_date === b.harvest_date);
    return collision
      ? {
        ...b,
        available_kg: Math.max(b.available_kg, collision.available_kg),
        age_days: Math.max(b.age_days, collision.age_days),
      }
      : b;
  });
  const extra = orphanList.filter((o) => !live.some((b) => b.harvest_date === o.harvest_date));
  return [...merged, ...extra];
}

function capFor(harvestDate: string | null, batches: IGaplamaBatch[]): number {
  return batches.find((b) => b.harvest_date === harvestDate)?.available_kg ?? 0;
}

function ageFor(harvestDate: string | null, batches: IGaplamaBatch[]): number {
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

interface IFoldedBlock {
  todayKg: number;
  leftoverKg: number;
  /** Max age among folded entries that carry a REAL date — 0 for an
   * explicit null harvest_date with no live leftover bucket to merge into,
   * which the form renders as an unknown age rather than a false "0 days
   * old" (see `leftoverAgeLabel`). */
  leftoverAgeDays: number;
}

/** Folds a truck's real per-row source data into at most two buckets per
 * block: today's own harvest and ONE leftover bucket summing everything
 * else. `noPerBatchData` (editingTruckBatches unresolved — the truck wasn't
 * found among the drafts, an edge case) has NO per-row harvest_date to read
 * at all, so every one of its block-level totals is pinned to the truck's
 * own day — same as it always was, before per-date leftover rows existed.
 * That is a DIFFERENT signal from an explicit null harvest_date on a real
 * per-batch row (per-batch data IS resolved, and that specific row has no
 * date because it's already part of the leftover pool on save) or a real
 * date that simply isn't the truck's own day (a truck saved before
 * batch-selection collapsed to two rows, 2026-09-25) — both of those fold
 * to the leftover bucket. Shared by `initialRowsFor` (seeds the form's
 * rows) and `computeOrphans` (floors each bucket's cap at what it already
 * holds) so the two can never disagree on which rows fold together. */
function foldEntriesByBlock(
  entries: IBlockSource[],
  truckDate: string,
  noPerBatchData: boolean,
): Record<number, IFoldedBlock> {
  const out: Record<number, IFoldedBlock> = {};
  for (const bs of entries) {
    if (bs.block_id == null) continue;
    // The bucket is registered — the block is on this truck, `initialRowsFor`
    // must still render its card — even when this specific row has no
    // weight yet (a supply-first draft's source written before a weight was
    // assigned, `views.py:2231`; the declared type says `number` but the API
    // can send null here). Only the accumulation below is skipped for it.
    const bucket = out[bs.block_id] ?? (out[bs.block_id] = { todayKg: 0, leftoverKg: 0, leftoverAgeDays: 0 });
    if (bs.weight_kg == null) continue;
    const realDate = noPerBatchData ? truckDate : (bs.harvest_date ?? null);
    if (realDate === truckDate) {
      bucket.todayKg += bs.weight_kg;
    } else {
      bucket.leftoverKg += bs.weight_kg;
      if (realDate) {
        bucket.leftoverAgeDays = Math.max(bucket.leftoverAgeDays, Math.max(0, dayjs(truckDate).diff(dayjs(realDate), 'day')));
      }
    }
  }
  return out;
}

/** The editing truck's own real source rows, folded to at most two buckets
 * per block (see `foldEntriesByBlock`) — shared by `computeOrphans` and
 * `initialRowsFor` so their fold decisions can never diverge. */
function foldedEditEntries(props: IGaplamaTruckFormProps): Record<number, IFoldedBlock> {
  if (!props.editingTruck) return {};
  const truckDate = props.editingTruck.date;
  // Real per-batch data when resolved (drafts endpoint) carries its own
  // harvest_date per row. The degrade-to-block-level-totals fallback
  // (editingTruckBatches unresolved) does not — no real per-batch
  // attribution exists at all, so `foldEntriesByBlock` pins it to the
  // truck's own day (today), NOT the leftover bucket — see that function's
  // own doc comment for why the two cases are different signals.
  const entries: IBlockSource[] = props.editingTruckBatches?.length
    ? props.editingTruckBatches
    : props.editingTruck.block_sources;
  const noPerBatchData = !props.editingTruckBatches?.length;
  return foldEntriesByBlock(entries, truckDate, noPerBatchData);
}

/** One orphan list per block — a floor on what its (at most two) batches
 * must be able to hold, from what the truck being edited already carries.
 * `effectiveBatches` is what actually decides what each entry is FOR: no
 * live match at all keeps the orphan's own kg as an exact cap (a leftover
 * bucket with nothing live to carry it, or a today bucket with no plan
 * today); a live match gets its cap raised to at least the orphan's own kg,
 * never lowered. Computed once, from the props the form mounted with; not
 * recomputed as `rows` changes. */
function computeOrphans(props: IGaplamaTruckFormProps): Record<number, IGaplamaBatch[]> {
  if (props.mode !== 'edit' || !props.editingTruck) return {};
  const truckDate = props.editingTruck.date;
  const folded = foldedEditEntries(props);
  const out: Record<number, IGaplamaBatch[]> = {};
  for (const [blockIdStr, f] of Object.entries(folded)) {
    const blockId = Number(blockIdStr);
    const list: IGaplamaBatch[] = [];
    if (f.todayKg > 0) list.push({ harvest_date: truckDate, age_days: 0, available_kg: f.todayKg });
    if (f.leftoverKg > 0) list.push({ harvest_date: null, age_days: f.leftoverAgeDays, available_kg: f.leftoverKg });
    out[blockId] = list;
  }
  return out;
}

function initialRowsFor(props: IGaplamaTruckFormProps): IRow[] {
  if (props.mode === 'edit' && props.editingTruck) {
    const truckDate = props.editingTruck.date;
    const folded = foldedEditEntries(props);
    const seeded: IRow[] = [];
    for (const [blockIdStr, f] of Object.entries(folded)) {
      const blockId = Number(blockIdStr);
      if (f.todayKg > 0) seeded.push({ blockId, harvestDate: truckDate, kg: f.todayKg });
      if (f.leftoverKg > 0) seeded.push({ blockId, harvestDate: null, kg: f.leftoverKg });
      // Registered (the block is on this truck — `foldEntriesByBlock`) but
      // contributed nothing to either bucket: every one of its source rows
      // had a null weight_kg. Without a row of its own the block's card
      // would never render at all (`chosenBlockIds` reads off `rows`) and
      // the operator would have no way to see this block is even on the
      // truck. Dated today (the same "no attribution" convention as the
      // no-per-batch-data fallback above) with an empty input to fill.
      if (f.todayKg === 0 && f.leftoverKg === 0) seeded.push({ blockId, harvestDate: truckDate, kg: null });
    }
    // Offer every OTHER live batch of a seeded block too (empty, kg: null) —
    // the truck may only have drawn from one of the two buckets so far, but
    // editing must let the operator move kg onto the other.
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
  // Create: start on the first block, every one of its (at most two)
  // batches on screen from the start.
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
  // The kg each row held when the form opened — zero for a row the operator
  // adds afterwards. Computed once, from the props the form mounted with,
  // same as `orphans`. Owner's 2026-09-25 rule: reducing a row, or leaving
  // it untouched, is always allowed, even above what the block currently
  // has — only an INCREASE past this floor is checked. See `rowInvalid`.
  const [seededKg] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const r of initialRowsFor(props)) {
      map[ROW_KEY(r.blockId, r.harvestDate)] = r.kg ?? 0;
    }
    return map;
  });
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
    // Leftover first, today's own row after (compareBatchDates) — always,
    // regardless of insertion order.
    return rows.filter((r) => r.blockId === blockId).sort((a, b) => compareBatchDates(a.harvestDate, b.harvestDate));
  }

  function blockTotal(blockId: number): number {
    return rowsForBlock(blockId).reduce((s, r) => s + (r.kg ?? 0), 0);
  }

  function rowInvalid(row: IRow): boolean {
    if (!row.kg) return false;
    // Reducing, or leaving untouched, is always allowed — even a row seeded
    // above what the block currently shows (another truck took the stock,
    // or an in-week plan cut landed after this truck was built). The kg
    // return to the block's derived remainder on their own; only an
    // INCREASE past what the row started with is ever checked below. This
    // also keeps an untouched sibling row in the same block from being
    // dragged down by a DIFFERENT row's increase busting the block total.
    if (row.kg <= (seededKg[ROW_KEY(row.blockId, row.harvestDate)] ?? 0)) return false;
    const batches = batchesForBlock(row.blockId);
    if (row.kg > capFor(row.harvestDate, batches)) return true;
    return blockTotal(row.blockId) > blockCapFor(row.blockId, props);
  }

  const anyExceeds = rows.some(rowInvalid);
  const totalKg = rows.reduce((s, r) => s + (r.kg ?? 0), 0);
  const hasAnyKg = totalKg > 0;
  const isPartial = totalKg > 0 && totalKg < props.truckCapacityKg;
  const submitDisabled = !hasAnyKg || anyExceeds;
  const kgCarryingRows = rows.filter((r) => r.kg);
  const oldestAgeDays = kgCarryingRows
    .reduce((max, r) => Math.max(max, ageFor(r.harvestDate, batchesForBlock(r.blockId))), 0);
  // The total line must not claim a false "oldest: 0 d" (0 reads as
  // fresh) when that 0 actually came from a leftover row whose age is
  // UNKNOWN, not genuinely zero — the same `age <= 0` signal
  // `leftoverAgeLabel` uses. A today row's own genuine 0 (nothing else on
  // the truck older) is left alone — `oldestAgeDays > 0` already rules
  // this branch out whenever some OTHER row's real age won the max.
  const oldestAgeUnknown = oldestAgeDays <= 0 && kgCarryingRows.some(
    (r) => r.harvestDate === null && ageFor(r.harvestDate, batchesForBlock(r.blockId)) <= 0,
  );

  function upsertRow(blockId: number, harvestDate: string | null, kg: number | null) {
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

  // Today's own row is always age 0 by construction (batches never expire
  // same-day) — the generic "N days" phrasing that used to live here
  // belonged to carry-in batches, which now render through
  // `leftoverAgeLabel` instead.
  function todayAgeLabel(): string {
    return t('tir_takip.gaplama.form.batch_age_fresh');
  }

  // The leftover row's age is an upper bound ("leftover, up to N days") —
  // the OLDER of the live bucket's age and the seeded row's own age when it
  // has one (`effectiveBatches`'s merge, 2026-09-25 fix: keeping only the
  // live bucket's age understated a row seeded from real kg picked well
  // before that bucket's own origin day). An orphan with nothing live to
  // merge into AND no real date of its own (an explicit null harvest_date
  // with no matching live bucket — the no-per-batch-data fallback folds to
  // TODAY, not here, see `foldEntriesByBlock`) carries no real age at all —
  // `age <= 0` is that signal (a genuine live carry-in bucket is always
  // >= 1 day old), rendered as "age unknown" rather than a false "up to 0
  // days".
  function leftoverAgeLabel(days: number): string {
    return days > 0
      ? t('tir_takip.gaplama.form.batch_leftover_age', { days })
      : t('tir_takip.gaplama.form.batch_leftover_unknown_age');
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
                    const isLeftover = row.harvestDate === null;
                    return (
                      <tr key={ROW_KEY(blockId, row.harvestDate)}>
                        <td>{isLeftover ? t('tir_takip.gaplama.form.batch_leftover_label') : row.harvestDate}</td>
                        <td>
                          <Tag className="sera-gaplama-batch-age">
                            {isLeftover ? leftoverAgeLabel(age) : todayAgeLabel()}
                          </Tag>
                        </td>
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
            {oldestAgeUnknown
              ? t('tir_takip.gaplama.form.batch_leftover_unknown_age')
              : t('tir_takip.gaplama.form.oldest_batch', { days: oldestAgeDays })}
          </span>
        )}
      </div>

      {/* Read once, not repeated per row (owner's instruction, meant to be
       * read as a sentence) — the offending input(s) stay marked invalid
       * (aria-invalid, red border) on their own row; this is the
       * explanation, shown once while any row is over. */}
      {anyExceeds && (
        <div className="sera-gaplama-form-overdraw-notice">
          {t('tir_takip.gaplama.form.insufficient_harvest')}
        </div>
      )}

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
