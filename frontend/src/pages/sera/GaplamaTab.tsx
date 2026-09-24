import { Fragment, useMemo, useState } from 'react';
import { Alert, Button, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useGaplamaBoard } from '@/hooks/useGaplama';
import { useDrafts } from '@/hooks/useDrafts';
import { useGreenhouseBlocks } from '@/hooks/useAdmin';
import { useGreenhouseConfig } from '@/hooks/useGreenhouseConfig';
import { useAuth } from '@/hooks/useAuth';
import { canDoBackendGated } from '@/utils/permissions';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { BlockFilterSelect } from './BlockFilterSelect';
import GaplamaTruckForm from './GaplamaTruckForm';
import { sumByLocation, trucksForDay, isPartialTruck, truckCountByLocation, truckTotalKg } from './GaplamaTab.totals';
import type { IGaplamaDay, IGaplamaTruck, IGreenhouseBlock } from '@/types';
import type { IPlanGridRow } from '@/pages/export/WeeklyPlanGrid.rows';
import './sera.css';

dayjs.extend(isoWeek);

const DAY_COUNT = 7;
const LOCATION_KEY_FALLBACK = 'other';

/** Grouped-thousands display, kept consistent with the rest of the app
 * (DraftComposerModal, salesReportUtils, etc. all use the same locale). */
function fmt(kg: number): string {
  return kg.toLocaleString('ru-RU');
}

export default function GaplamaTab(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(dayjs().format('YYYY-MM-DD'));
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [foldOpen, setFoldOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTruck, setEditingTruck] = useState<IGaplamaTruck | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<number[] | null>(null);

  const weekStart = dayjs().add(weekOffset, 'week').isoWeekday(1);
  const days = Array.from({ length: DAY_COUNT }, (_, i) => weekStart.add(i, 'day').format('YYYY-MM-DD'));
  const today = dayjs().format('YYYY-MM-DD');
  const weekContainsToday = days.includes(today);

  const { data: config } = useGreenhouseConfig();
  // Decimal-as-string, per the api-contract convention — coerce at the point
  // of use, same as useGaplama.ts's queryFn does for the board response.
  const truckCapacityKg = Number(config?.truck_capacity_kg) || 18500;

  // Exactly the displayed week — NOT `weekStart - gaplama_carry_days`.
  // Widening the request here used to inflate week_totals' summed fields
  // (plan/loaded/over) with days outside the week actually shown
  // (2026-09-23, final-review I1). Removing the widening is safe ONLY
  // because the server's own internal lookback was deepened to compensate
  // (build_gaplama_board's walk_start is now 2×gaplama_carry_days before
  // from_date, not 1× — see that function's docstring): a single
  // carry_days of server-side lookback protects from_date's OWN zero-seed
  // boundary, but not the correctness of walk_start's own day, which a
  // narrower client request would otherwise have silently degraded.
  const fetchFrom = weekStart.format('YYYY-MM-DD');
  const fetchTo = weekStart.add(DAY_COUNT - 1, 'day').format('YYYY-MM-DD');
  const { data: board, isLoading, isError } = useGaplamaBoard(fetchFrom, fetchTo);

  // A Gaplama truck is always a draft — the Üýtget button only ever shows
  // for status_code==='draft' (see `canEdit` below) — so the drafts endpoint
  // is the one place with this truck's REAL per-batch block_sources
  // (DraftBlockSourceInlineSerializer carries harvest_date; the board's own
  // trucks[] does not — see task-7-report.md, Gap 1/edit-seeding). Only
  // consumed for edit-mode seeding; the form itself gates its own mount on
  // this resolving (below) so its one-time useState(initialRows) never runs
  // against stale/undefined data.
  const { data: drafts } = useDrafts();

  const { data: blocksData } = useGreenhouseBlocks();
  // Top-level, active blocks only — sub-blocks and inactive blocks never
  // appear in the board's days[] rows either (backend/apps/export/services/
  // gaplama.py filters the same way), so including them here would render
  // grid rows with no matching data.
  const topLevelBlocks = (blocksData ?? []).filter(
    (b: IGreenhouseBlock) => b.parent === null && b.is_active,
  );
  // For the truck form's block-card header (❄ N gün) — unfiltered, same
  // reasoning as buildAvailableByBlock/buildBatchesByBlock below.
  const carryDaysByBlock: Record<number, number> = {};
  for (const b of topLevelBlocks) carryDaysByBlock[b.id] = b.carry_days;

  const blocks = topLevelBlocks.filter(
    (b) =>
      (selectedBlockIds === null || selectedBlockIds.includes(b.id))
      && (selectedLocation === null || (b.location_name ?? LOCATION_KEY_FALLBACK) === selectedLocation),
  );

  // BlockFilterSelect (already on the branch, built for Önümçilik) takes
  // IPlanGridRow[], not a bare block list — its grouped-by-location dropdown
  // reads only block/code/name/location_name from each row. Gaplama has no
  // per-block plan to attach, so `plan` and the plan-derived fields are
  // always empty; the filter option list itself only needs the block facts.
  const filterRows: IPlanGridRow[] = topLevelBlocks.map((b) => ({
    key: `block-${b.id}`,
    block: b.id,
    block_code: b.code,
    block_name: b.name || b.code,
    location: b.location,
    location_name: b.location_name,
    plan: null,
    block_manager_names: [],
    late_edit_active: false,
  }));

  // Independent of the block filter — a block removed from view by the
  // block picker must stay pickable as a location to bring it back.
  const allLocationNames = Array.from(
    new Set(topLevelBlocks.map((b) => b.location_name ?? LOCATION_KEY_FALLBACK)),
  ).sort((a, b) => a.localeCompare(b));

  // Scoped to the displayed week AND the active block/location filter — every
  // grid row, footer total and location subtotal reads from this, so a
  // filter stays consistent everywhere instead of the per-block rows
  // respecting it while the aggregate rows silently summed the whole board.
  const visibleBlockIds = new Set(blocks.map((b) => b.id));
  const boardDays = (board?.days ?? []).filter(
    (d) => days.includes(d.date) && visibleBlockIds.has(d.block_id),
  );
  // Defensive: the board endpoint's own internal carry-over lookback could in
  // principle still surface a truck dated before `fetchFrom` on some future
  // response shape; keep it out of the displayed week's truck list/count
  // regardless — it would have no matching day column to filter it by.
  const trucks = (board?.trucks ?? []).filter((tr) => days.includes(tr.date));

  // Week-aggregate "available" figures (D8/I1, 2026-09-23) — server-computed,
  // never a client-side sum of available_kg across days (that double-counts
  // a remainder that stays live for several days). Scoped to the active
  // block filter, same as boardDays above. Plain object build, not useMemo —
  // visibleBlockIds is a fresh Set every render, so memoizing on it would
  // never actually hit cache.
  const weekTotalsByBlock: Record<number, number> = {};
  for (const total of board?.week_totals ?? []) {
    if (visibleBlockIds.has(total.block_id)) weekTotalsByBlock[total.block_id] = total.available_kg;
  }

  const canCreate = canDoBackendGated(user, 'shipment', 'create') && !isReadOnly;

  const rowsByBlock = useMemo(() => {
    const map: Record<number, IGaplamaDay[]> = {};
    for (const row of boardDays) {
      map[row.block_id] = map[row.block_id] ?? [];
      map[row.block_id].push(row);
    }
    return map;
  }, [boardDays]);

  // D16 grouping: blocks bucketed by GreenhouseBlock.location_name (the display
  // string — "Dusak"/"Kaka"/"Owadandepe" per LoadingLocation.name), NOT
  // `location` (that field is the location's numeric id, and the board's
  // IGaplamaDay.location carries the same name string this groups by, so the
  // two must match on the name, not the id). A block with no location falls
  // into its own trailing "other" group instead of being silently dropped.
  const blocksByLocation = useMemo(() => {
    const map: Record<string, IGreenhouseBlock[]> = {};
    for (const block of blocks) {
      const loc = block.location_name ?? LOCATION_KEY_FALLBACK;
      map[loc] = map[loc] ?? [];
      map[loc].push(block);
    }
    return map;
  }, [blocks]);
  const locationOrder = Object.keys(blocksByLocation)
    .filter((loc) => loc !== LOCATION_KEY_FALLBACK)
    .sort((a, b) => a.localeCompare(b))
    .concat(blocksByLocation[LOCATION_KEY_FALLBACK]?.length ? [LOCATION_KEY_FALLBACK] : []);

  // location_name is already the real display string (a place name, not a
  // code), except for the synthetic 'other' bucket, which needs the one
  // translated fallback label.
  function locationLabel(location: string): string {
    return location === LOCATION_KEY_FALLBACK
      ? t('tir_takip.gaplama.location_other')
      : location;
  }

  function weekdayLabel(date: string): string {
    return t(`tir_takip.gaplama.weekday_${dayjs(date).isoWeekday()}`);
  }

  // Resolved against the RAW, unfiltered board — never `boardDays` (also
  // scoped to the active block filter). The truck form must be able to cap
  // and offer a block the grid's own filter currently hides (§ buildAvailableByBlock
  // below), so the cap lookup itself must ignore that filter too.
  function capForBlockDate(blockId: number, date: string): number {
    return (board?.days ?? []).find((r) => r.block_id === blockId && r.date === date)?.available_kg ?? 0;
  }

  // Built over `topLevelBlocks` (unfiltered by selectedBlockIds), never
  // `blocks` — the form must be able to cap and offer a block that the grid's
  // own block filter currently hides, or an edit on a truck sourced from a
  // filtered-out block would show it with a 0 cap and no way to select it.
  function buildAvailableByBlock(date: string): Record<number, number> {
    const map: Record<number, number> = {};
    for (const b of topLevelBlocks) map[b.id] = capForBlockDate(b.id, date);
    return map;
  }

  // Per-block batch list for the truck form's batch table (2026-09-24, batch
  // selection) — the board's `carry_in_breakdown` (oldest first) plus today's
  // own plan folded in as a same-day batch, exactly mirroring how
  // `build_gaplama_board` itself treats today's plan as a same-day bucket.
  // Same unfiltered block set and raw-board source as buildAvailableByBlock —
  // the form must be able to offer a block the grid's own filter hides.
  function buildBatchesByBlock(
    date: string,
  ): Record<number, { harvest_date: string; age_days: number; available_kg: number }[]> {
    const map: Record<number, { harvest_date: string; age_days: number; available_kg: number }[]> = {};
    for (const b of topLevelBlocks) {
      const row = (board?.days ?? []).find((r) => r.block_id === b.id && r.date === date);
      const batches = (row?.carry_in_breakdown ?? []).map((c) => ({
        harvest_date: c.origin_date,
        age_days: c.age_days,
        available_kg: c.kg,
      }));
      batches.push({ harvest_date: date, age_days: 0, available_kg: row?.plan_kg ?? 0 });
      map[b.id] = batches;
    }
    return map;
  }

  function openCreateForm() {
    setEditingTruck(null);
    setFormOpen(true);
  }

  function openEditForm(truck: IGaplamaTruck) {
    setEditingTruck(truck);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingTruck(null);
  }

  // Moves selectedDay one day at a time and only rolls weekOffset on
  // crossing a week boundary — the day-stepper replaces clicking a column
  // header, which was never discoverable (owner's redesign brief).
  function stepDay(delta: 1 | -1) {
    // Week mode has no week-level prev/next of its own (the filter bar
    // spec, Step 3, lists only this one stepper) — a full week per click
    // here, always crossing exactly one week boundary, keeps ◀/▶ able to
    // reach any week without a separate control. Day mode still moves one
    // day at a time and only rolls weekOffset on crossing Sun/Mon.
    if (mode === 'week') {
      setWeekOffset((w) => w + delta);
      setSelectedDay((d) => dayjs(d).add(delta * DAY_COUNT, 'day').format('YYYY-MM-DD'));
      return;
    }
    const next = dayjs(selectedDay).add(delta, 'day');
    const currentMonday = dayjs(selectedDay).isoWeekday(1).format('YYYY-MM-DD');
    const nextMonday = next.isoWeekday(1).format('YYYY-MM-DD');
    if (nextMonday !== currentMonday) setWeekOffset((w) => w + delta);
    setSelectedDay(next.format('YYYY-MM-DD'));
  }

  // ─── Day mode ───────────────────────────────────────────────────────────
  const selectedDayRowByBlock: Record<number, IGaplamaDay | undefined> = {};
  for (const b of blocks) {
    selectedDayRowByBlock[b.id] = rowsByBlock[b.id]?.find((r) => r.date === selectedDay);
  }
  // A block folds away when there's nothing to show for it today — no row at
  // all, or a row with neither an available remainder nor an overload. An
  // overloaded block (over_kg > 0) must NOT fold — that's the red alert this
  // redesign exists to surface, not hide.
  function isEmptyToday(block: IGreenhouseBlock): boolean {
    const row = selectedDayRowByBlock[block.id];
    return !row || (row.available_kg === 0 && row.over_kg === 0);
  }
  const foldedBlocks = blocks.filter(isEmptyToday);

  return (
    <div className="sera-gaplama-tab">
      <div className="sera-gaplama-header">
        <Select
          allowClear
          placeholder={t('tir_takip.gaplama.location_all')}
          style={{ minWidth: 160 }}
          value={selectedLocation ?? undefined}
          onChange={(v) => setSelectedLocation(v ?? null)}
          options={allLocationNames.map((loc) => ({ value: loc, label: locationLabel(loc) }))}
        />
        <BlockFilterSelect rows={filterRows} value={selectedBlockIds} onChange={setSelectedBlockIds} />
        <span className="sera-gaplama-daystepper">
          <Button onClick={() => stepDay(-1)}>◀</Button>
          <span data-testid="gaplama-current-day" data-day={selectedDay}>
            {weekdayLabel(selectedDay)} {dayjs(selectedDay).format('DD.MM')}
          </span>
          <Button onClick={() => stepDay(1)}>▶</Button>
        </span>
        <span className="sera-gaplama-mode-toggle">
          <Button type={mode === 'day' ? 'primary' : 'default'} onClick={() => setMode('day')}>
            {t('tir_takip.gaplama.mode_day')}
          </Button>
          <Button type={mode === 'week' ? 'primary' : 'default'} onClick={() => setMode('week')}>
            {t('tir_takip.gaplama.mode_week')}
          </Button>
        </span>
        <span className="sera-gaplama-header-spacer" />
        {canCreate && !formOpen && (
          <Button type="primary" disabled={!weekContainsToday} onClick={openCreateForm}>
            + {t('tir_takip.gaplama.open_truck')}
          </Button>
        )}
      </div>

      <div className="sera-gaplama-formula">
        {t('tir_takip.gaplama.formula_hint')}
      </div>

      {isError ? (
        <Alert type="error" message={t('tir_takip.gaplama.error_load')} showIcon />
      ) : isLoading ? (
        <div>{t('tir_takip.gaplama.loading')}</div>
      ) : mode === 'day' ? (
        <table className="sera-gaplama-grid">
          <thead>
            <tr>
              <th>{t('tir_takip.gaplama.block')}</th>
              <th>{t('tir_takip.gaplama.available')}</th>
              <th>{t('tir_takip.gaplama.plan')}</th>
              <th>{t('tir_takip.gaplama.col_loaded')}</th>
              <th>{t('tir_takip.gaplama.col_carry')}</th>
              <th>{t('tir_takip.gaplama.col_carry_out')}</th>
              <th>{t('tir_takip.gaplama.col_trucks')}</th>
            </tr>
          </thead>
          <tbody>
            {locationOrder.map((location) => {
              const visibleBlocksInLoc = blocksByLocation[location].filter((b) => !isEmptyToday(b));
              if (visibleBlocksInLoc.length === 0) return null;
              const subtotalAvailable = visibleBlocksInLoc.reduce(
                (sum, b) => sum + (selectedDayRowByBlock[b.id]?.available_kg ?? 0), 0,
              );
              const subtotalPlan = visibleBlocksInLoc.reduce(
                (sum, b) => sum + (selectedDayRowByBlock[b.id]?.plan_kg ?? 0), 0,
              );
              const subtotalLoaded = visibleBlocksInLoc.reduce(
                (sum, b) => sum + (selectedDayRowByBlock[b.id]?.loaded_kg ?? 0), 0,
              );
              const subtotalCarried = visibleBlocksInLoc.reduce(
                (sum, b) => sum + (selectedDayRowByBlock[b.id]?.carried_in_kg ?? 0), 0,
              );
              const subtotalCarriedOut = visibleBlocksInLoc.reduce(
                (sum, b) => sum + (selectedDayRowByBlock[b.id]?.carried_out_kg ?? 0), 0,
              );
              return (
                <Fragment key={location}>
                  <tr className="sera-gaplama-location-header">
                    <td colSpan={7}>{locationLabel(location)}</td>
                  </tr>
                  {visibleBlocksInLoc.map((block) => {
                    const row = selectedDayRowByBlock[block.id];
                    const available = row?.available_kg ?? 0;
                    const over = row?.over_kg ?? 0;
                    const plan = row?.plan_kg ?? 0;
                    const loaded = row?.loaded_kg ?? 0;
                    const carried = row?.carried_in_kg ?? 0;
                    const carriedOut = row?.carried_out_kg ?? 0;
                    const isOver = over > 0;
                    const isFull = !isOver && available >= truckCapacityKg;
                    const cellClass = isOver ? 'sera-gaplama-cell-over' : isFull ? 'sera-gaplama-cell-full' : undefined;
                    // Oldest bucket first, one line per origin day — matches
                    // the FIFO consumption order (design spec §3①).
                    const carryTooltip = (row?.carry_in_breakdown ?? [])
                      .map((b) => `${dayjs(b.origin_date).format('DD.MM')}: ${fmt(b.kg)} kg (${t('tir_takip.gaplama.carry_age', { days: b.age_days })})`)
                      .join('\n');
                    return (
                      <tr key={block.id}>
                        <td className="sera-gaplama-block-name">
                          {block.name || block.code}
                          {/* Written on screen, not only in a hover title —
                              tablets (WeeklyPlanGrid/greenhouse managers)
                              never see a title attribute. */}
                          <div className="sera-gaplama-carry-window">
                            {t('tir_takip.gaplama.carry_window', { days: block.carry_days })}
                          </div>
                        </td>
                        <td className={cellClass}>
                          {isOver ? t('tir_takip.gaplama.over_tooltip', { kg: fmt(over) }) : fmt(available)}
                        </td>
                        <td>{fmt(plan)}</td>
                        <td>{fmt(loaded)}</td>
                        <td
                          className={carried > 0 ? 'sera-gaplama-carry-in' : undefined}
                          title={carryTooltip || undefined}
                        >
                          {carried > 0 ? `+${fmt(carried)}` : '—'}
                        </td>
                        <td>{carriedOut > 0 ? fmt(carriedOut) : '—'}</td>
                        <td>{Math.floor(available / truckCapacityKg)}</td>
                      </tr>
                    );
                  })}
                  <tr className="sera-gaplama-location-subtotal">
                    <td>{t('tir_takip.gaplama.location_subtotal')}</td>
                    <td>{fmt(subtotalAvailable)}</td>
                    <td>{fmt(subtotalPlan)}</td>
                    <td>{fmt(subtotalLoaded)}</td>
                    <td>{subtotalCarried > 0 ? `+${fmt(subtotalCarried)}` : '—'}</td>
                    <td>{subtotalCarriedOut > 0 ? fmt(subtotalCarriedOut) : '—'}</td>
                    <td>{truckCountByLocation({ [location]: subtotalAvailable }, truckCapacityKg)}</td>
                  </tr>
                </Fragment>
              );
            })}
            {foldedBlocks.length > 0 && (
              <>
                <tr className="sera-gaplama-folded-row" onClick={() => setFoldOpen((o) => !o)}>
                  <td colSpan={7}>
                    {foldOpen ? '▾' : '▸'} {t('tir_takip.gaplama.folded_blocks', { count: foldedBlocks.length })}
                  </td>
                </tr>
                {foldOpen && foldedBlocks.map((block) => (
                  <tr key={`folded-${block.id}`} className="sera-gaplama-folded-block">
                    <td className="sera-gaplama-block-name">
                      {block.name || block.code} ({locationLabel(block.location_name ?? LOCATION_KEY_FALLBACK)})
                    </td>
                    <td colSpan={6}>—</td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
          <tfoot>
            <tr className="sera-gaplama-footer-tir-sany">
              <td>{t('tir_takip.gaplama.tir_sany')}</td>
              <td colSpan={6}>
                {truckCountByLocation(
                  Object.fromEntries(locationOrder.map((loc) => [
                    loc,
                    blocksByLocation[loc].reduce((sum, b) => sum + (selectedDayRowByBlock[b.id]?.available_kg ?? 0), 0),
                  ])),
                  truckCapacityKg,
                )}
              </td>
            </tr>
            <tr className="sera-gaplama-footer-trucks">
              <td>📦 {t('tir_takip.gaplama.opened_trucks')}</td>
              <td colSpan={6}>
                {trucksForDay(trucks, selectedDay).map((tr) => (
                  <div key={tr.id} className="sera-gaplama-truck-chip">
                    {tr.shipment_code} · {fmt(truckTotalKg(tr))} kg
                  </div>
                ))}
              </td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <table className="sera-gaplama-grid">
          <thead>
            <tr>
              <th>{t('tir_takip.gaplama.block')}</th>
              {days.map((d) => (
                <th key={d} className={d === today ? 'sera-gaplama-day-today' : ''}>
                  <div className="sera-gaplama-weekday">{weekdayLabel(d)}</div>
                  <div>{dayjs(d).format('DD.MM')}</div>
                </th>
              ))}
              <th>{t('tir_takip.gaplama.week_total')}</th>
            </tr>
          </thead>
          <tbody>
            {/* D16: blocks are grouped by location, each group with its own
                subtotal row, so 10 000+10 000 split across two locations reads
                as "no full truck" instead of a single misleading 20 000 sum. */}
            {locationOrder.map((location) => (
              <Fragment key={location}>
                <tr className="sera-gaplama-location-header">
                  <td colSpan={days.length + 2}>{locationLabel(location)}</td>
                </tr>
                {blocksByLocation[location].map((block: IGreenhouseBlock) => (
                  <tr key={block.id}>
                    <td
                      className="sera-gaplama-block-name"
                      title={t('tir_takip.gaplama.carry_window', { days: block.carry_days })}
                    >
                      {block.name || block.code}
                    </td>
                    {days.map((d) => {
                      const row = rowsByBlock[block.id]?.find((r) => r.date === d);
                      const available = row?.available_kg ?? 0;
                      const over = row?.over_kg ?? 0;
                      const isOver = over > 0;
                      const isFull = !isOver && available >= truckCapacityKg;
                      const cellClass = isOver ? 'sera-gaplama-cell-over' : isFull ? 'sera-gaplama-cell-full' : undefined;
                      // The four stacked numbers the old grid showed per cell
                      // (available/over, carry-in breakdown, carry-out, plan
                      // hint) are folded into this one title attribute —
                      // the owner's redesign keeps the week grid to one
                      // number per cell, everything else on hover.
                      const titleLines = [
                        row && row.plan_kg > 0 ? t('tir_takip.gaplama.plan_hint', { kg: fmt(row.plan_kg) }) : null,
                        row && row.carried_in_kg > 0
                          ? (row.carry_in_breakdown ?? [])
                            .map((b) => `${dayjs(b.origin_date).format('DD.MM')}: +${fmt(b.kg)} kg`)
                            .join('\n')
                          : null,
                        row && row.carried_out_kg > 0 ? `${fmt(row.carried_out_kg)} kg →` : null,
                      ].filter(Boolean).join('\n');
                      return (
                        <td key={d} className={cellClass} title={titleLines || undefined}>
                          {isOver ? t('tir_takip.gaplama.over_tooltip', { kg: fmt(over) }) : fmt(available)}
                        </td>
                      );
                    })}
                    <td>{fmt(weekTotalsByBlock[block.id] ?? 0)}</td>
                  </tr>
                ))}
                <tr className="sera-gaplama-location-subtotal">
                  <td>{t('tir_takip.gaplama.location_subtotal')}</td>
                  {days.map((d) => (
                    <td key={d}>{fmt(sumByLocation(boardDays, d, 'available_kg')[location] ?? 0)}</td>
                  ))}
                  <td>
                    {fmt(blocksByLocation[location].reduce(
                      (sum: number, b: IGreenhouseBlock) => sum + (weekTotalsByBlock[b.id] ?? 0),
                      0,
                    ))}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="sera-gaplama-footer-tir-sany">
              <td>{t('tir_takip.gaplama.tir_sany')}</td>
              {days.map((d) => (
                <td key={d}>
                  {truckCountByLocation(sumByLocation(boardDays, d, 'available_kg'), truckCapacityKg)}
                </td>
              ))}
              <td>
                {truckCountByLocation(
                  Object.fromEntries(locationOrder.map((loc) => [
                    loc,
                    blocksByLocation[loc].reduce((sum, b) => sum + (weekTotalsByBlock[b.id] ?? 0), 0),
                  ])),
                  truckCapacityKg,
                )}
              </td>
            </tr>
            <tr className="sera-gaplama-footer-trucks">
              <td>📦 {t('tir_takip.gaplama.opened_trucks')}</td>
              {days.map((d) => (
                <td key={d}>
                  {trucksForDay(trucks, d).map((tr) => (
                    <div key={tr.id} className="sera-gaplama-truck-chip">
                      {tr.shipment_code} · {fmt(truckTotalKg(tr))} kg
                    </div>
                  ))}
                </td>
              ))}
              <td>{trucks.length} {t('tir_takip.gaplama.trucks_unit')}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <div className="sera-gaplama-truck-open">
        {formOpen && (!editingTruck || drafts) && (
          <GaplamaTruckForm
            // Forces a remount whenever "what we're editing" changes —
            // without this, clicking Üýtget on a truck while the create
            // form is still open (rows typed, unsubmitted) changes
            // `editingTruck`/`mode` but React keeps the same instance
            // (same position, no key), so the form's own
            // useState(initialRows) never re-runs: it would report
            // mode="edit" while still showing the stale create-mode rows,
            // and submitting would write the wrong block/kg data to the
            // wrong truck. Same reasoning covers Üýtget on truck A then,
            // without submitting, Üýtget on truck B. The create key also
            // carries `selectedDay` (2026-09-24 fix) — stepping the day
            // while the create form is open must not leave it showing the
            // old day's batch rows against the new day's caps.
            key={editingTruck ? `edit-${editingTruck.id}` : `create-${selectedDay}`}
            mode={editingTruck ? 'edit' : 'create'}
            // The day this truck is dated — the day being VIEWED
            // (selectedDay), not real "today" (2026-09-24 fix: `+ Tır Aç`
            // after stepping the board forward/back must open a truck dated
            // the day being viewed).
            today={editingTruck ? editingTruck.date : selectedDay}
            editingTruck={editingTruck ?? undefined}
            editingTruckBatches={
              editingTruck ? drafts?.find((d) => d.id === editingTruck.id)?.block_sources : undefined
            }
            availableByBlock={buildAvailableByBlock(editingTruck ? editingTruck.date : selectedDay)}
            batchesByBlock={buildBatchesByBlock(editingTruck ? editingTruck.date : selectedDay)}
            carryDaysByBlock={carryDaysByBlock}
            blocks={topLevelBlocks.map((b) => ({ id: b.id, code: b.code, label: b.name || b.code }))}
            truckCapacityKg={truckCapacityKg}
            onDone={closeForm}
            onCancel={closeForm}
          />
        )}
      </div>

      {trucks.length > 0 && (
      <div className="sera-gaplama-truck-list">
        <table>
          <thead>
            <tr>
              <th>{t('tir_takip.gaplama.code')}</th>
              <th>{t('tir_takip.gaplama.blocks')}</th>
              <th>{t('tir_takip.gaplama.kg')}</th>
              <th>{t('tir_takip.gaplama.status')}</th>
              <th>{t('tir_takip.gaplama.date')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trucks.map((truck) => {
              // Üýtget writes through TWO server-side gates: POST
              // block-sources (shipment.create) then PATCH weight_net
              // (shipment.edit + a field grant) — visibility must
              // match both, or a create-but-not-edit role can rewrite
              // the truck's split, then 403 on the weight sync.
              const canEdit = canCreate
                && canDoBackendGated(user, 'shipment', 'edit')
                && truck.status_code === 'draft'
                && truck.country == null && truck.customer == null;
              return (
                <tr key={truck.id}>
                  <td>
                    {truck.shipment_code}
                    {truck.export_code && ` (${truck.export_code})`}
                  </td>
                  <td>
                    {truck.block_sources
                      .map((s) => `${s.block_code} (${fmt(s.weight_kg)} kg)`)
                      .join(' + ')}
                  </td>
                  <td>
                    {fmt(truckTotalKg(truck))}
                    {isPartialTruck(truck, truckCapacityKg) && (
                      <span className="sera-gaplama-partial-tag">
                        {t('tir_takip.gaplama.partial')}
                      </span>
                    )}
                  </td>
                  <td>{truck.status_display}</td>
                  <td>{truck.date}</td>
                  <td>
                    {canEdit && (
                      <Button size="small" onClick={() => openEditForm(truck)}>
                        {t('tir_takip.gaplama.edit')}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
