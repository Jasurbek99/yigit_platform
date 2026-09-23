import { Fragment, useMemo, useState } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useGaplamaBoard } from '@/hooks/useGaplama';
import { useGreenhouseBlocks } from '@/hooks/useAdmin';
import { useGreenhouseConfig } from '@/hooks/useGreenhouseConfig';
import { useAuth } from '@/hooks/useAuth';
import { canDoBackendGated } from '@/utils/permissions';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { BlockFilterSelect } from './BlockFilterSelect';
import GaplamaTruckForm from './GaplamaTruckForm';
import { sumByLocation, trucksForDay, isPartialTruck, weekTotal, truckTotalKg } from './GaplamaTab.totals';
import type { IGaplamaTruck, IGreenhouseBlock } from '@/types';
import type { IPlanGridRow } from '@/pages/export/WeeklyPlanGrid.rows';
import './sera.css';

dayjs.extend(isoWeek);

const DAY_COUNT = 7;

export default function GaplamaTab(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTruck, setEditingTruck] = useState<IGaplamaTruck | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<number[] | null>(null);

  const weekStart = dayjs().add(weekOffset, 'week').isoWeekday(1);
  const days = Array.from({ length: DAY_COUNT }, (_, i) => weekStart.add(i, 'day').format('YYYY-MM-DD'));
  const today = dayjs().format('YYYY-MM-DD');
  const weekContainsToday = days.includes(today);

  const { data: config } = useGreenhouseConfig();
  const carryDays = config?.gaplama_carry_days ?? 2;
  // Decimal-as-string, per the api-contract convention — coerce at the point
  // of use, same as useGaplama.ts's queryFn does for the board response.
  const truckCapacityKg = Number(config?.truck_capacity_kg) || 18500;

  const fetchFrom = weekStart.subtract(carryDays, 'day').format('YYYY-MM-DD');
  const fetchTo = weekStart.add(DAY_COUNT - 1, 'day').format('YYYY-MM-DD');
  const { data: board, isLoading } = useGaplamaBoard(fetchFrom, fetchTo);

  const { data: blocksData } = useGreenhouseBlocks();
  // Top-level, active blocks only — sub-blocks and inactive blocks never
  // appear in the board's days[] rows either (backend/apps/export/services/
  // gaplama.py filters the same way), so including them here would render
  // grid rows with no matching data.
  const topLevelBlocks = (blocksData ?? []).filter(
    (b: IGreenhouseBlock) => b.parent === null && b.is_active,
  );
  const blocks = topLevelBlocks.filter(
    (b) => selectedBlockIds === null || selectedBlockIds.includes(b.id),
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

  const boardDays = (board?.days ?? []).filter((d) => days.includes(d.date));
  const trucks = board?.trucks ?? [];

  const canCreate = canDoBackendGated(user, 'shipment', 'create') && !isReadOnly;

  const rowsByBlock = useMemo(() => {
    const map: Record<number, typeof boardDays> = {};
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
  const LOCATION_KEY_FALLBACK = 'other';
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

  function availableFor(blockId: number, date: string): number {
    return boardDays.find((r) => r.block_id === blockId && r.date === date)?.available_kg ?? 0;
  }

  const availableByBlockToday: Record<number, number> = {};
  for (const b of blocks) availableByBlockToday[b.id] = availableFor(b.id, today);

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

  const weekHasTrucks = trucks.length > 0;

  return (
    <div className="sera-gaplama-tab">
      <div className="sera-gaplama-header">
        <Button onClick={() => setWeekOffset((w) => w - 1)}>◀ {t('tir_takip.gaplama.prev_week')}</Button>
        <Button type={weekOffset === 0 ? 'primary' : 'default'} onClick={() => setWeekOffset(0)}>
          {t('tir_takip.gaplama.this_week')}
        </Button>
        <Button onClick={() => setWeekOffset((w) => w + 1)}>{t('tir_takip.gaplama.next_week')} ▶</Button>
        <BlockFilterSelect rows={filterRows} value={selectedBlockIds} onChange={setSelectedBlockIds} />
      </div>

      {isLoading ? (
        <div>{t('tir_takip.gaplama.loading')}</div>
      ) : (
        <table className="sera-gaplama-grid">
          <thead>
            <tr>
              <th>{t('tir_takip.gaplama.block')}</th>
              {days.map((d) => (
                <th
                  key={d}
                  className={selectedDay === d ? 'sera-gaplama-day-selected' : ''}
                  onClick={() => setSelectedDay(selectedDay === d ? null : d)}
                >
                  {dayjs(d).format('DD.MM')}
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
                    <td className="sera-gaplama-block-name">{block.name}</td>
                    {days.map((d) => {
                      const row = rowsByBlock[block.id]?.find((r) => r.date === d);
                      const over = row?.over_kg ?? 0;
                      const carried = row?.carried_in_kg ?? 0;
                      return (
                        <td key={d}>
                          {over > 0 ? (
                            <span title={t('tir_takip.gaplama.over_tooltip', { kg: over })}>0 ⚠</span>
                          ) : (
                            <span>{row?.available_kg ?? 0}</span>
                          )}
                          {carried > 0 && <div className="sera-gaplama-carry-in">+{carried}</div>}
                          {row && row.plan_kg > 0 && (
                            <div className="sera-gaplama-plan-hint">
                              {t('tir_takip.gaplama.plan_hint', { kg: row.plan_kg })}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td>{weekTotal(rowsByBlock[block.id] ?? [], 'available_kg')}</td>
                  </tr>
                ))}
                <tr className="sera-gaplama-location-subtotal">
                  <td>{t('tir_takip.gaplama.location_subtotal')}</td>
                  {days.map((d) => (
                    <td key={d}>{sumByLocation(boardDays, d, 'available_kg')[location] ?? 0}</td>
                  ))}
                  <td>
                    {blocksByLocation[location].reduce(
                      (sum: number, b: IGreenhouseBlock) => sum + weekTotal(rowsByBlock[b.id] ?? [], 'available_kg'),
                      0,
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="sera-gaplama-footer-jemi-plan">
              <td>{t('tir_takip.gaplama.jemi_plan')}</td>
              {days.map((d) => (
                <td key={d}>{weekTotal(boardDays.filter((r) => r.date === d), 'plan_kg')}</td>
              ))}
              <td>{weekTotal(boardDays, 'plan_kg')}</td>
            </tr>
            {locationOrder.map((location) => (
              <tr key={`tir-sany-${location}`} className="sera-gaplama-footer-tir-sany">
                <td>
                  {t('tir_takip.gaplama.tir_sany')} — {locationLabel(location)}
                </td>
                {days.map((d) => {
                  const planKg = sumByLocation(boardDays, d, 'plan_kg')[location] ?? 0;
                  const count = planKg > 0 ? (planKg / truckCapacityKg).toFixed(2) : '—';
                  return <td key={d}>{count}</td>;
                })}
                <td>—</td>
              </tr>
            ))}
            <tr className="sera-gaplama-footer-trucks">
              <td>📦 {t('tir_takip.gaplama.opened_trucks')}</td>
              {days.map((d) => (
                <td key={d}>
                  {trucksForDay(trucks, d).map((tr) => (
                    <div key={tr.id} className="sera-gaplama-truck-chip">
                      {tr.shipment_code} · {truckTotalKg(tr)} kg
                    </div>
                  ))}
                </td>
              ))}
              <td>{trucks.length} {t('tir_takip.gaplama.trucks_unit')}</td>
            </tr>
            <tr className="sera-gaplama-footer-carry-in">
              <td>{t('tir_takip.gaplama.duynki_galyndy')}</td>
              {days.map((d) => {
                // weekTotal's field union is plan/loaded/available_kg only
                // (GaplamaTab.totals.ts) — carried_in_kg is summed inline.
                const carried = boardDays
                  .filter((r) => r.date === d)
                  .reduce((sum, r) => sum + r.carried_in_kg, 0);
                return <td key={d}>{carried > 0 ? `+${carried}` : '—'}</td>;
              })}
              <td>—</td>
            </tr>
            <tr className="sera-gaplama-footer-galan">
              <td>{t('tir_takip.gaplama.galan')}</td>
              {days.map((d) => (
                <td key={d}>{weekTotal(boardDays.filter((r) => r.date === d), 'available_kg')}</td>
              ))}
              <td>{weekTotal(boardDays, 'available_kg')}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <div className="sera-gaplama-truck-open">
        {!formOpen ? (
          canCreate && (
            <Button type="primary" disabled={!weekContainsToday} onClick={openCreateForm}>
              + {t('tir_takip.gaplama.open_truck')}
            </Button>
          )
        ) : (
          <GaplamaTruckForm
            mode={editingTruck ? 'edit' : 'create'}
            today={today}
            editingTruck={editingTruck ?? undefined}
            availableByBlock={availableByBlockToday}
            blocks={blocks.map((b) => ({ id: b.id, code: b.code, label: b.name || b.code }))}
            truckCapacityKg={truckCapacityKg}
            onDone={closeForm}
            onCancel={closeForm}
          />
        )}
      </div>

      {weekHasTrucks && (
        <>
          <div className="sera-gaplama-summary">
            <table>
              <thead>
                <tr>
                  <th>{t('tir_takip.gaplama.block')}</th>
                  <th>{t('tir_takip.gaplama.plan')}</th>
                  <th>{t('tir_takip.gaplama.loaded')}</th>
                  <th>{t('tir_takip.gaplama.available')}</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((block: IGreenhouseBlock) => {
                  const rows = (rowsByBlock[block.id] ?? []).filter(
                    (r) => selectedDay === null || r.date === selectedDay,
                  );
                  return (
                    <tr key={block.id}>
                      <td>{block.name}</td>
                      <td>{weekTotal(rows, 'plan_kg')}</td>
                      <td>{weekTotal(rows, 'loaded_kg')}</td>
                      <td>{weekTotal(rows, 'available_kg')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

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
                {trucks
                  .filter((tr) => selectedDay === null || tr.date === selectedDay)
                  .map((truck) => {
                    const canEdit = canCreate && truck.status_code === 'draft'
                      && truck.country == null && truck.customer == null;
                    return (
                      <tr key={truck.id}>
                        <td>
                          {truck.shipment_code}
                          {truck.export_code && ` (${truck.export_code})`}
                        </td>
                        <td>
                          {truck.block_sources
                            .map((s) => `${s.block_code} (${s.weight_kg} kg)`)
                            .join(' + ')}
                        </td>
                        <td>
                          {truckTotalKg(truck)}
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
        </>
      )}
    </div>
  );
}
