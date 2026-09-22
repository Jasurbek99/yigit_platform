import { useState, useMemo } from 'react';
import {
  Table,
  DatePicker,
  Tag,
  Skeleton,
  Alert,
  Flex,
  Typography,
  Button,
  Space,
  Card,
  Collapse,
  Statistic,
  Modal,
  Tooltip,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { toast } from 'sonner';
import {
  SwapOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  UndoOutlined,
  UserOutlined,
  PlusOutlined,
  MinusOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import {
  useHarvestPlans,
  useDayEntries,
  useUpsertDayEntry,
  useBulkGrantLateEdit,
  useBulkRevokeLateEdit,
} from '@/hooks/usePlanning';
import { useGreenhouseConfig } from '@/hooks/useGreenhouseConfig';
import { useSeasons, useGreenhouseBlocks } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import { useUiStore } from '@/stores/uiStore';
import { OnumcilikCell } from './OnumcilikCell';
import type { IOnumcilikCellSavePayload } from './OnumcilikCell';
import { getCurrentForecastWindow, num, fmtKg } from '@/components/HarvestCell.helpers';
import { CellHistoryModal } from '@/components/CellHistoryModal';
import { GrantExtensionModal } from '@/components/GrantExtensionModal';
import type { IWeeklyHarvestPlan, IHarvestDayEntry } from '@/types';
import { TruckAllocationTable } from '@/pages/export/TruckAllocationTable';
import { planGridCapabilities } from '@/pages/export/WeeklyPlanGrid.roles';
import { buildPlanGridRows } from '@/pages/export/WeeklyPlanGrid.rows';
import type { IPlanGridRow } from '@/pages/export/WeeklyPlanGrid.rows';
import { sumBlockWeek, sumAllBlocks } from './OnumcilikTab.totals';
import { filterPlansByBlock } from './OnumcilikTab.blockFilter';
import { BlockFilterSelect } from './BlockFilterSelect';
import { COLORS } from '@/constants/styles';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);

const { Title, Text } = Typography;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = (typeof DAYS)[number];

/**
 * Önümçilik — the first tab of Tır Takip.
 *
 * This is a **deliberate verbatim copy** of `pages/export/WeeklyPlanGrid.tsx`,
 * not an accidental duplicate. Do not de-duplicate it back into a shared
 * component: the sera pages carry their own visual language by owner request
 * ("new pages have another design, don't change ours"), so this file is
 * restyled away from antd while `/export/plan` stays exactly as it is. A
 * shared component with a `variant` prop would put both designs in one file
 * and make every future change to either one a risk to the other.
 *
 * What is shared and NOT copied: the hooks, `CellHistoryModal`,
 * `GrantExtensionModal`, `TruckAllocationTable`, `WeeklyPlanGrid.roles`,
 * `WeeklyPlanGrid.rows` (`buildPlanGridRows`/`IPlanGridRow`), and the `plan.*`
 * i18n keys. Those are logic and data, which both designs agree on; fork one
 * only when the restyle actually reaches it. `HarvestCell` is NOT shared —
 * this tab renders `OnumcilikCell` instead (plan-only, always an input; see
 * that file's header).
 *
 * Create-on-write (2026-09-16): rows come from the block list
 * (`buildPlanGridRows`), not from the plan list, so every active block shows
 * up whether or not its week has been written to yet. There is no more
 * "Initialize Week" step — the first value typed into any cell creates that
 * week's rows via `POST .../write-cell/`.
 */
export default function OnumcilikTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Deep links (weekly-plan tasks, boss heatmap) carry ?week=&year=&block=.
  // `block` is a block_id from task links but a block_code from the heatmap, so
  // match either when highlighting the linked row.
  const deepLinkBlock = searchParams.get('block');

  const [selectedWeek, setSelectedWeek] = useState<Dayjs | null>(() => {
    // Honor a task/heatmap deep link's ISO week; Jan 4 is always in ISO week 1,
    // so adding (week-1) weeks lands on the target ISO week regardless of year.
    const wk = Number(searchParams.get('week'));
    const yr = Number(searchParams.get('year'));
    if (wk && yr) return dayjs(`${yr}-01-04`).add(wk - 1, 'week');
    // After Thursday (Fri/Sat/Sun) the current week's past/today cells are read-only
    // for managers, so default to next week to land on editable cells.
    return dayjs().isoWeekday() > 4 ? dayjs().add(1, 'week') : dayjs();
  });
  const transposed = useUiStore((s) => s.planPivotMode);
  const setTransposed = useUiStore((s) => s.setPlanPivotMode);
  const showSunday = useUiStore((s) => s.planShowSunday);
  const setShowSunday = useUiStore((s) => s.setPlanShowSunday);
  // Sunday is the last day in DAYS, so dropping it keeps every other day's
  // index (di) intact — used for date offsets and day_of_week throughout.
  const activeDays: Day[] = showSunday ? [...DAYS] : DAYS.slice(0, 6);
  const [historyEntry, setHistoryEntry] = useState<IHarvestDayEntry | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [extensionModalOpen, setExtensionModalOpen] = useState(false);
  // Task 3 — `null` means "no filter, show every block", the grid's default
  // so it looks unchanged until someone touches the dropdown.
  const [selectedBlockIds, setSelectedBlockIds] = useState<number[] | null>(null);

  const weekNumber = selectedWeek?.isoWeek();
  const year = selectedWeek?.isoWeekYear();
  // Task 1 — the middle nav button is "primary" only when the browsed week IS
  // this actual calendar week, not merely "no offset from a default": the
  // default lands on NEXT week after Thursday (see selectedWeek's initialiser
  // above), so comparing ISO week/year is the only correct test.
  const isCurrentWeek = weekNumber === dayjs().isoWeek() && year === dayjs().isoWeekYear();

  // `activeSeason` (the TRUE active/write-target season, never the browsed
  // one) is used only for `TruckAllocationTable`'s `seasonId` prop below. It
  // is deliberately NOT passed into useHarvestPlans/useDayEntries: those are
  // reads, and the hooks own season selection internally via the global store
  // (useSelectedSeason()), so the season switcher actually has an effect on
  // this page.
  const { data: seasonsData } = useSeasons();
  const activeSeason = seasonsData?.find((s) => s.is_active);
  // The season the grid's DATA actually belongs to (`useHarvestPlans` /
  // `useDayEntries` read via the global switcher) — used only for the header
  // label, so it never shows the wrong season's name beside browsed-season
  // figures.
  const { seasonId: browsedSeasonId } = useSelectedSeason();
  const browsedSeason = seasonsData?.find((s) => s.id === browsedSeasonId);
  const isReadOnly = useSeasonReadOnly();
  const { data: config } = useGreenhouseConfig();

  // ─── Week date range for day-entry queries ─────────────────────────────────

  const weekMonday = selectedWeek ? selectedWeek.isoWeekday(1) : dayjs().isoWeekday(1);
  const weekSunday = weekMonday.add(6, 'day');
  const dateFrom = weekMonday.format('YYYY-MM-DD');
  const dateTo = weekSunday.format('YYYY-MM-DD');

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const { data: blocksData, isLoading: blocksLoading } = useGreenhouseBlocks();
  const { data: plansData, isLoading: plansLoading, isError } = useHarvestPlans({ year, week: weekNumber });
  const { data: dayEntries = [], isLoading: entriesLoading } = useDayEntries({
    date_from: dateFrom,
    date_to: dateTo,
  });

  const upsertEntry = useUpsertDayEntry();
  const bulkGrant = useBulkGrantLateEdit();
  const bulkRevoke = useBulkRevokeLateEdit();

  const isLoading = blocksLoading || plansLoading || entriesLoading;

  // ─── Derived data ──────────────────────────────────────────────────────────

  const myBlockIds = useMemo(() => new Set(user?.managed_block_ids ?? []), [user?.managed_block_ids]);
  const isBlockManager = user?.role === 'greenhouse_manager' && myBlockIds.size > 0;
  // Role -> capability rules live in WeeklyPlanGrid.roles.ts so they can be
  // unit-tested without rendering this component; every rationale comment moved
  // with them. `hasBlockPermission` stayed here — it is the one rule keyed on
  // data (managed_block_ids) rather than on role.
  const { isAdminLike, canEditHarvest, canEditTrucks } = planGridCapabilities({ role: user?.role, isReadOnly });

  const plans: IWeeklyHarvestPlan[] = useMemo(() => {
    const raw = plansData?.results ?? [];
    if (!isBlockManager) return raw;
    const mine = raw.filter((p) => myBlockIds.has(p.block));
    const rest = raw.filter((p) => !myBlockIds.has(p.block));
    return [...mine, ...rest];
  }, [plansData, isBlockManager, myBlockIds]);

  /**
   * Row source (Task 2) — one row per active top-level block, whether or not
   * its week has a plan yet; `buildPlanGridRows` is shared with `/export/plan`
   * (`WeeklyPlanGrid.rows.ts`). Reordered mine-first the same way `plans`
   * above is: `buildPlanGridRows` sorts by the admin-defined block order and
   * has no notion of "the current user", so that reorder stays a display
   * concern of this list.
   */
  const rows: IPlanGridRow[] = useMemo(() => {
    const built = buildPlanGridRows(blocksData ?? [], plans);
    if (!isBlockManager) return built;
    const mine = built.filter((r) => myBlockIds.has(r.block));
    const rest = built.filter((r) => !myBlockIds.has(r.block));
    return [...mine, ...rest];
  }, [blocksData, plans, isBlockManager, myBlockIds]);

  /** Task 3 — display-only filter over `rows`. Everything that isn't a block
   * ROW/COLUMN in one of the two table views keeps reading the full `plans`
   * (real plan objects only exist for blocks with one): `activeExtensionPlans`
   * / `allPlanIds` (bulk late-edit grant targets) and `TruckAllocationTable`'s
   * `plans` prop. The filter narrows what the grid shows, not what a bulk
   * action reaches. */
  const visibleRows = useMemo(
    () => filterPlansByBlock(rows, selectedBlockIds),
    [rows, selectedBlockIds],
  );

  /** Map keyed by `${blockId}-${YYYY-MM-DD}` → IHarvestDayEntry */
  const entriesByBlockDay = useMemo((): Map<string, IHarvestDayEntry> => {
    const map = new Map<string, IHarvestDayEntry>();
    for (const e of dayEntries) {
      map.set(`${e.block}-${e.entry_date}`, e);
    }
    return map;
  }, [dayEntries]);

  // Fallback mode button visibility
  const isInFallbackWindow: boolean = useMemo(() => {
    if (!config) return false;
    const now = dayjs();
    const tomorrow = now.startOf('day').add(1, 'day');
    const win = getCurrentForecastWindow(now, tomorrow, config);
    return win === 'fallback';
  }, [config]);

  // loading_dept_head replaced warehouse_chief on this surface in May 2026.
  // Admin keeps access for ops support. The fallback-mode UI itself is now
  // a subset of loading_dept_head's broader window and may be retired later.
  const canSeeFallbackMode =
    user?.role === 'loading_dept_head' || user?.role === 'loading_dept_head_deputy' || user?.role === 'admin';

  // ─── KPI totals from day entries ───────────────────────────────────────────

  // Deliberately summed over ALL of `dayEntries`, not `visibleRows` — these
  // feed TruckAllocationTable's `totalPlanKg`/`dayTotals`, which need the true
  // week figure regardless of the block filter above the grid.
  //
  // 2026-09-16 — the grid is plan-only: every actual total below is commented
  // out rather than deleted, so the rollup numbers can be restored in one pass.
  // The late/critical-late counters went with the "Late submissions" tile they
  // fed. `plan_state` is still written and still drives the dispatcher and the
  // /export/plan tile — nothing on this page counts it any more.
  const { totalPlan, /* totalActual, */ dayPlanTotals } = useMemo(() => {
    let plan = 0; /* actual = 0; */
    const dayTotalsMap: Record<string, number> = {};
    for (const e of dayEntries) {
      const v = num(e.plan_value);
      plan += v;
      // actual += e.actual_value != null ? num(e.actual_value) : 0;
      dayTotalsMap[e.entry_date] = (dayTotalsMap[e.entry_date] ?? 0) + v;
    }
    return {
      totalPlan: plan,
      // totalActual: actual,
      dayPlanTotals: dayTotalsMap,
    };
  }, [dayEntries]);

  const truckCapacity = config ? Number(config.truck_capacity_kg) : 18500;
  const estTrucks = totalPlan > 0 ? (totalPlan / truckCapacity).toFixed(1) : '0';

  /** Plans that currently have an active late-edit extension */
  const activeExtensionPlans = useMemo(
    () => plans.filter((p) => p.late_edit_active),
    [plans],
  );

  /** IDs of all currently-displayed plans (for bulk grant) */
  const allPlanIds = useMemo(() => plans.map((p) => p.id), [plans]);

  /** IDs of plans with an active extension (for bulk revoke) */
  const activeExtensionIds = useMemo(
    () => activeExtensionPlans.map((p) => p.id),
    [activeExtensionPlans],
  );

  // ─── Permission helpers ────────────────────────────────────────────────────

  function hasBlockPermission(blockId: number): boolean {
    if (!user) return false;
    if (canEditHarvest) return true;
    if (user.role === 'greenhouse_manager') return user.managed_block_ids.includes(blockId);
    return false;
  }

  /** Keyed on the block id directly (not on an entry) so it works whether or
   * not this block+day has a row yet — a missing cell needs the same
   * editability answer an existing one would get. */
  function canEditPlanForBlock(blockId: number): boolean {
    if (isReadOnly) return false;
    if (!hasBlockPermission(blockId)) return false;
    // Both admin and greenhouse_manager can edit any plan cell at any time.
    // Lateness is tracked via entry.plan_state and surfaces as a cell badge;
    // late/critical_late submissions notify admin + director.
    return true;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleCellSave(payload: IOnumcilikCellSavePayload) {
    // Task 2 — a missing cell has no id, so it needs a saving key that still
    // identifies it uniquely: the block+date it's about to create.
    const key = payload.entryId != null ? String(payload.entryId) : `${payload.block}-${payload.entryDate}`;
    setSavingKey(key);
    const mutationPayload = payload.entryId != null
      ? { id: payload.entryId, plan_value: payload.value, ...(payload.reason ? { reason: payload.reason } : {}) }
      : { block: payload.block, entry_date: payload.entryDate, plan_value: payload.value };
    // Read before saving: a withdraw comes back 200 with `pending_change: null`,
    // exactly like a plain save, so only the prior state tells them apart. A cell
    // with no row yet (create-on-write) can never have a pending change.
    const hadPending =
      payload.entryId != null
      && dayEntries.find((e) => e.id === payload.entryId)?.pending_change != null;
    upsertEntry.mutate(mutationPayload, {
      onSuccess: (saved) => {
        // Once the plan week has started a manager's edit becomes a pending
        // PlanChangeRequest (ADR-024) and the cell stays empty — saying "saved"
        // here would claim a value the grid is not showing.
        if (saved.pending_change) {
          toast.info(t('plan.toast_sent_for_approval'));
        } else if (hadPending && !isAdminLike) {
          toast.info(t('plan.toast_change_withdrawn'));
        } else {
          toast.success(t('plan.toast_plan_saved'));
        }
        setSavingKey(null);
      },
      onError: (err: unknown) => {
        // A refusal from write-cell/PATCH is HTTP 400 keyed by field —
        // `{"plan_value": "..."}` — not `{"error": "..."}`. Tolerate DRF's
        // list-wrapped form too so this doesn't silently regress if the
        // backend ever normalizes it.
        const apiErr = err as {
          response?: { data?: { plan_value?: string | string[]; error?: string } };
        };
        const rawField = apiErr?.response?.data?.plan_value;
        const fieldMsg = Array.isArray(rawField) ? rawField[0] : rawField;
        const serverMsg = fieldMsg ?? apiErr?.response?.data?.error ?? '';
        if (serverMsg.includes('Plan edits')) {
          toast.error(t('plan.edit_window_closed_toast'));
        } else if (serverMsg) {
          toast.error(serverMsg);
        } else {
          toast.error(t('plan.toast_save_error'));
        }
        setSavingKey(null);
      },
    });
  }

  function handleBulkGrant(granted_until: string) {
    bulkGrant.mutate(
      { plan_ids: allPlanIds, granted_until },
      {
        onSuccess: (data) => {
          toast.success(t('plan.bulk_grant_toast', { count: data.updated }));
          setExtensionModalOpen(false);
        },
        onError: (err: unknown) => {
          const apiErr = err as { response?: { data?: { error?: string; granted_until?: string[] } } };
          const msg =
            apiErr?.response?.data?.granted_until?.[0] ??
            apiErr?.response?.data?.error ??
            t('common.error');
          toast.error(msg);
        },
      },
    );
  }

  function handleBulkRevoke() {
    Modal.confirm({
      title: t('plan.bulk_revoke_confirm_title'),
      content: t('plan.bulk_revoke_confirm_content'),
      okType: 'danger',
      okText: t('plan.bulk_revoke_button'),
      cancelText: t('common.cancel'),
      onOk() {
        bulkRevoke.mutate(
          { plan_ids: activeExtensionIds },
          {
            onSuccess: (data) => toast.success(t('plan.bulk_revoke_toast', { count: data.updated })),
            onError: () => toast.error(t('common.error')),
          },
        );
      },
    });
  }

  // ─── Column definitions (normal view: blocks as rows) ─────────────────────

  // The dates actually on screen. Hiding Sunday drops it from here too, so the
  // Total column only ever counts columns the reader can add up by eye.
  // Not memoised: `weekMonday` is a fresh Dayjs every render, so a dep array
  // would never hit — and this is six string formats.
  const visibleDateKeys = activeDays.map((_, di) =>
    weekMonday.add(di, 'day').format('YYYY-MM-DD'),
  );

  const todayKey = dayjs().format('YYYY-MM-DD');

  /** Task 2 — the Sunday show/hide control, moved from the toolbar `Button`
   * into the table itself. Shared between the normal view's last day-column
   * header and the pivot view's last day-row label (see transposedColumns
   * below) so there is exactly one control, rendered wherever the currently
   * active view puts it. */
  function renderSundayToggle() {
    const label = showSunday ? t('plan.hide_sunday') : t('plan.show_sunday');
    return (
      <Tooltip title={label}>
        <button
          type="button"
          className="sera-sunday-toggle"
          aria-label={label}
          onClick={() => setShowSunday(!showSunday)}
        >
          {showSunday ? <MinusOutlined /> : <PlusOutlined />}
        </button>
      </Tooltip>
    );
  }

  const dayColumns = activeDays.map((day, di) => {
    const colDate = weekMonday.add(di, 'day');
    const colDateStr = colDate.format('YYYY-MM-DD');
    return {
      // Amber today column, ported from sera — highlight and caption both.
      className: colDateStr === todayKey ? 'sera-today-col' : undefined,
      title: (
        <div style={{ textAlign: 'center', lineHeight: '16px', position: 'relative' }}>
          {/* Task 2 — anchored to the LAST visible day column, which is always
              "immediately left of Total" regardless of which day that is
              (Saturday when hidden, Sunday when shown). Absolutely positioned
              so it never shifts the other columns' centered text. */}
          {di === activeDays.length - 1 && (
            <span style={{ position: 'absolute', top: -4, right: -4 }}>{renderSundayToggle()}</span>
          )}
          <div>{t(`plan.${day}`)}</div>
          <div style={{ fontSize: 10, color: COLORS.textSecondary, fontWeight: 400 }}>
            {colDate.format('DD.MM')}
          </div>
          {/* Sera's "şu gün" line, in whichever language the user is reading.
              Rendered only under today's date, so it never costs height on the
              other six columns. */}
          {colDateStr === todayKey && <div className="sera-today-caption">{t('plan.today')}</div>}
        </div>
      ),
      key: `${day}_cell`,
      width: 120,
      render: (_: unknown, row: IPlanGridRow) => {
        const entry = entriesByBlockDay.get(`${row.block}-${colDateStr}`);
        return (
          <OnumcilikCell
            entry={entry ?? null}
            block={row.block}
            entryDate={colDateStr}
            canEdit={canEditPlanForBlock(row.block)}
            onSave={handleCellSave}
            onCellClick={(id) => {
              const found = dayEntries.find((e) => e.id === id);
              if (found) setHistoryEntry(found);
            }}
            isAdmin={isAdminLike}
            savingKey={savingKey}
          />
        );
      },
    };
  });

  const columns: TableColumnsType<IPlanGridRow> = [
    {
      title: t('plan.block'),
      key: 'block',
      fixed: 'left',
      width: 160,
      render: (_: unknown, row: IPlanGridRow) => {
        const isLinked =
          !!deepLinkBlock &&
          (String(row.block) === deepLinkBlock || row.block_code === deepLinkBlock);
        return (
        <div
          style={
            isLinked
              ? { background: COLORS.bgLight, borderLeft: `3px solid ${COLORS.primary}`, paddingLeft: 6, margin: '-2px 0' }
              : undefined
          }
        >
          {/* The block_code tag is deliberately gone (owner request): the name
              alone identifies the row here. It also carried the gold/blue
              "this is one of my blocks" marker for a block manager — that
              signal survives on the row itself, which `onRow` gives a yellow
              background and an inset gold left bar. */}
          <span className="sera-block-name">{row.block_name}</span>
          {row.late_edit_active && (
            <Tag color="orange" style={{ marginLeft: 6, fontSize: 10 }}>
              <ClockCircleOutlined />
            </Tag>
          )}
          {/* Task 3 — the block's location (Dusak / Kaka / Owadandepe), now
              that `/core/blocks/` carries it. Nothing rendered for a block
              with none, rather than a placeholder line. */}
          {row.location_name && (
            <div className="sera-block-location">{row.location_name}</div>
          )}
          {row.block_manager_names.length > 0 && (
            <div style={{ color: COLORS.textMuted, fontSize: 10, marginTop: 1 }}>
              <UserOutlined style={{ marginRight: 3 }} />
              {row.block_manager_names.join(', ')}
            </div>
          )}
        </div>
        );
      },
    },
    ...dayColumns,
    {
      // `JEMI` in the sera app — one block's visible week, summed. Last column
      // and not sticky, as it is there. Header reuses `plan.total`, the string
      // the total ROW already uses, so the two totals read as the same idea.
      title: t('plan.total'),
      key: 'week_total',
      width: 110,
      className: 'sera-total-col',
      render: (_: unknown, row: IPlanGridRow) => {
        // Plan only, because the day-total row below it is plan only — its
        // actual line is commented out. A row total that showed a second figure
        // the column it terminates does not show would read as a discrepancy.
        const { plan } = sumBlockWeek(entriesByBlockDay, row.block, visibleDateKeys);
        return <div className="sera-total-plan">{fmtKg(plan || null)}</div>;
      },
    },
  ];

  // ─── Transposed view (days as rows, blocks as columns) ────────────────────

  interface ITransposedRow {
    key: string;
    day: Day;
    dayLabel: string;
    dateStr: string;
  }

  const transposedData: ITransposedRow[] = activeDays.map((day, di) => {
    const colDate = weekMonday.add(di, 'day');
    return {
      key: day,
      day,
      dayLabel: `${t(`plan.${day}`)} ${colDate.format('DD.MM')}`,
      dateStr: colDate.format('YYYY-MM-DD'),
    };
  });

  const transposedColumns: TableColumnsType<ITransposedRow> = [
    {
      title: '',
      dataIndex: 'dayLabel',
      key: 'day',
      fixed: 'left',
      width: 100,
      // Task 2, pivot mirror — no day-column header exists in this view
      // (days are rows here), so the same toggle sits beside the last
      // visible day's row label instead. Still one control; only its
      // position changes with the view.
      render: (text: string, row: ITransposedRow) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <strong>{text}</strong>
          {row.day === activeDays[activeDays.length - 1] && renderSundayToggle()}
        </span>
      ),
    },
    ...visibleRows.map((blockRow) => {
      const isMine = isBlockManager && myBlockIds.has(blockRow.block);
      return {
        title: (
          <div style={{ textAlign: 'center' as const }}>
            <Tag color={isMine ? 'gold' : 'blue'}>{blockRow.block_code}</Tag>
            {blockRow.block_manager_names.length > 0 && (
              <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 400, marginTop: 1 }}>
                {blockRow.block_manager_names.join(', ')}
              </div>
            )}
          </div>
        ),
        key: blockRow.block_code,
        width: 130,
        onCell: () => ({ style: isMine ? { backgroundColor: COLORS.bgYellow } : undefined }),
        onHeaderCell: () => ({ style: isMine ? { backgroundColor: COLORS.bgYellow } : undefined }),
        render: (_: unknown, row: ITransposedRow) => {
          const entry = entriesByBlockDay.get(`${blockRow.block}-${row.dateStr}`);
          return (
            /* Same cell as the normal view. A pivot toggle changes which axis
               is which, not what a cell means. */
            <OnumcilikCell
              entry={entry ?? null}
              block={blockRow.block}
              entryDate={row.dateStr}
              canEdit={canEditPlanForBlock(blockRow.block)}
              onSave={handleCellSave}
              onCellClick={(id) => {
                const found = dayEntries.find((e) => e.id === id);
                if (found) setHistoryEntry(found);
              }}
              isAdmin={isAdminLike}
              savingKey={savingKey}
            />
          );
        },
      };
    }),
  ];

  // ─── Summary row helpers ───────────────────────────────────────────────────

  function renderSummary() {
    return (
      <Table.Summary.Row style={{ fontWeight: 600 }}>
        <Table.Summary.Cell index={0}>{t('plan.total')}</Table.Summary.Cell>
        {activeDays.map((day, di) => {
          const colDate = weekMonday.add(di, 'day');
          const colDateStr = colDate.format('YYYY-MM-DD');
          const planTotal = visibleRows.reduce((s, r) => {
            const e = entriesByBlockDay.get(`${r.block}-${colDateStr}`);
            return s + num(e?.plan_value);
          }, 0);
          // const actualTotal = visibleRows.reduce((s, r) => {
          //   const e = entriesByBlockDay.get(`${r.block}-${colDateStr}`);
          //   return s + num(e?.actual_value);
          // }, 0);
          return (
            <Table.Summary.Cell key={`sum_${day}`} index={1 + di}>
              <div>
                <div className="sera-total-plan">{fmtKg(planTotal || null)}</div>
                {/* actualTotal > 0 && (
                  <div style={{ color: COLORS.success, fontSize: 12 }}>{fmtKg(actualTotal)}</div>
                ) */}
              </div>
            </Table.Summary.Cell>
          );
        })}
        {/* Where the Total column meets the total row. Summed from the same
            per-block function as the column above, so the corner can never
            disagree with it — and both read from `visibleRows`, so the
            block filter narrows this the same way it narrows the table. */}
        <Table.Summary.Cell key="sum_week" index={1 + activeDays.length} className="sera-total-col">
          <div className="sera-total-plan">
            {fmtKg(
              sumAllBlocks(entriesByBlockDay, visibleRows.map((r) => r.block), visibleDateKeys)
                .plan || null,
            )}
          </div>
        </Table.Summary.Cell>
      </Table.Summary.Row>
    );
  }

  function renderTransposedSummary() {
    return (
      <>
        <Table.Summary.Row style={{ fontWeight: 600 }}>
          <Table.Summary.Cell index={0}>
            <span style={{ color: COLORS.primary }}>{t('plan.total')} {t('plan.plan')}</span>
          </Table.Summary.Cell>
          {visibleRows.map((blockRow, i) => {
            const blockTotal = activeDays.reduce((s, _, di) => {
              const colDate = weekMonday.add(di, 'day');
              const e = entriesByBlockDay.get(`${blockRow.block}-${colDate.format('YYYY-MM-DD')}`);
              return s + num(e?.plan_value);
            }, 0);
            return (
              <Table.Summary.Cell key={`tp_${blockRow.key}`} index={1 + i}>
                <span style={{ color: COLORS.primary }}>{fmtKg(blockTotal || null)}</span>
              </Table.Summary.Cell>
            );
          })}
        </Table.Summary.Row>
      </>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      <Flex justify="space-between" align="flex-start" wrap gap={12} style={{ marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('plan.title')}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('plan.week')} {weekNumber} · {year} · {rows.length} {t('plan.blocks')}
            {browsedSeason && <span> · {browsedSeason.name}</span>}
          </Text>
        </div>
        <Space wrap>
          {/* Task 3 — block-row filter; built from the FULL `rows` (not
              `visibleRows`) so a block removed from view stays pickable to
              bring back. */}
          {rows.length > 0 && (
            <BlockFilterSelect rows={rows} value={selectedBlockIds} onChange={setSelectedBlockIds} />
          )}
          {rows.length > 0 && (
            <Button
              icon={<SwapOutlined />}
              onClick={() => setTransposed(!transposed)}
              type={transposed ? 'primary' : 'default'}
            >
              {t('plan.pivot')}
            </Button>
          )}
          {isAdminLike && plans.length > 0 && (
            <Button
              icon={<ClockCircleOutlined />}
              size="small"
              disabled={isReadOnly}
              onClick={() => setExtensionModalOpen(true)}
            >
              {t('plan.bulk_grant_button')}
            </Button>
          )}
          {isAdminLike && activeExtensionIds.length > 0 && (
            <Button
              danger
              size="small"
              icon={<UndoOutlined />}
              loading={bulkRevoke.isPending}
              disabled={isReadOnly}
              onClick={handleBulkRevoke}
            >
              {t('plan.bulk_revoke_button')}
            </Button>
          )}
          {canSeeFallbackMode && isInFallbackWindow && (
            <Button
              type="primary"
              danger
              icon={<ThunderboltOutlined />}
              onClick={() => navigate('/greenhouse/fallback-forecast')}
            >
              {t('plan.fallback_mode')}
            </Button>
          )}
          {/* Task 1 — sera's three-button week nav (App.jsx:13389-13391),
              labelled prev / this-week / next, plus the week DatePicker
              immediately to its left, both moved to the right-hand end of
              the toolbar — the slot the removed Generate/Initialize buttons
              used to occupy. Every other control above keeps its position. */}
          <DatePicker
            picker="week"
            value={selectedWeek}
            onChange={(d) => setSelectedWeek(d)}
            allowClear={false}
            style={{ width: 180 }}
          />
          <Space size={4} className="sera-week-nav">
            <Button size="small" onClick={() => setSelectedWeek((w) => (w ?? dayjs()).subtract(1, 'week'))}>
              ◀ {t('plan.prev_week')}
            </Button>
            <Button
              size="small"
              type={isCurrentWeek ? 'primary' : 'default'}
              onClick={() => setSelectedWeek(dayjs())}
            >
              {t('plan.this_week')}
            </Button>
            <Button size="small" onClick={() => setSelectedWeek((w) => (w ?? dayjs()).add(1, 'week'))}>
              {t('plan.next_week')} ▶
            </Button>
          </Space>
        </Space>
      </Flex>

      {/* KPI stat cards */}
      {rows.length > 0 && (
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t('plan.total_plan')}
              value={totalPlan}
              suffix="kg"
              styles={{ content: { color: COLORS.primary, fontSize: 20 } }}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card>
          {/* <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t('plan.total_actual')}
              value={totalActual}
              suffix="kg"
              styles={{ content: { color: COLORS.success, fontSize: 20 } }}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card> */}
          <Card size="small" style={{ flex: 1, minWidth: 150 }}>
            <Statistic
              title={t('plan.est_trucks')}
              value={estTrucks}
              styles={{ content: { color: COLORS.purple, fontSize: 20 } }}
              suffix={t('plan.trucks_suffix')}
            />
          </Card>
          {/* The "Late submissions" tile is deliberately absent here (owner
              request). It still exists on /export/plan, where chasing late
              block managers is the job; this tab is for reading the week's
              tonnage. `plan_state` is unaffected — the backend still records
              on_time/late/critical_late and the dispatcher still notifies. */}
        </Flex>
      )}

      {/* Late-edit extension banners (visible to all roles) */}
      {activeExtensionPlans.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            activeExtensionPlans.length <= 2 ? (
              <Flex vertical gap={4}>
                {activeExtensionPlans.map((p) => (
                  <div key={p.id}>
                    <strong>{p.block_code}</strong>{' '}
                    {t('plan.extension_active', {
                      until: dayjs(p.late_edit_granted_until!).format('DD.MM.YYYY HH:mm'),
                      by: p.late_edit_granted_by_name ?? '—',
                    })}
                    {p.late_edit_granted_reason && (
                      <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>
                        {t('plan.extension_reason', { reason: p.late_edit_granted_reason })}
                      </div>
                    )}
                  </div>
                ))}
              </Flex>
            ) : (
              <details>
                <summary>
                  {t('plan.extensions_active_count', { count: activeExtensionPlans.length })}
                </summary>
                <Flex vertical gap={4} style={{ marginTop: 4 }}>
                  {activeExtensionPlans.map((p) => (
                    <div key={p.id}>
                      <strong>{p.block_code}</strong>{' '}
                      {t('plan.extension_active', {
                        until: dayjs(p.late_edit_granted_until!).format('DD.MM.YYYY HH:mm'),
                        by: p.late_edit_granted_by_name ?? '—',
                      })}
                      {p.late_edit_granted_reason && (
                        <div style={{ color: COLORS.textSecondary, fontSize: 12 }}>
                          {t('plan.extension_reason', { reason: p.late_edit_granted_reason })}
                        </div>
                      )}
                    </div>
                  ))}
                </Flex>
              </details>
            )
          }
        />
      )}

      {isError && (
        <Alert type="error" message={t('plan.error_load')} style={{ marginBottom: 16 }} />
      )}

      {isLoading ? (
        <Skeleton active />
      ) : transposed ? (
        <Table<ITransposedRow>
          columns={transposedColumns}
          dataSource={transposedData}
          rowKey="key"
          bordered
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={false}
          summary={renderTransposedSummary}
        />
      ) : (
        <Table<IPlanGridRow>
          columns={columns}
          dataSource={visibleRows}
          rowKey="key"
          bordered
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={false}
          summary={renderSummary}
          onRow={(row) => ({
            style: {
              backgroundColor:
                isBlockManager && myBlockIds.has(row.block) ? COLORS.bgYellow : undefined,
              boxShadow:
                isBlockManager && myBlockIds.has(row.block)
                  ? 'inset 3px 0 0 #faad14'
                  : undefined,
            },
          })}
        />
      )}

      {/* Truck allocation section */}
      {plans.length > 0 && (
        <Collapse
          defaultActiveKey={['trucks']}
          style={{ marginTop: 16 }}
          items={[
            {
              key: 'trucks',
              label: <strong>{t('plan.truck_allocation')}</strong>,
              children: (
                <TruckAllocationTable
                  plans={plans}
                  weekNumber={weekNumber}
                  year={year}
                  seasonId={activeSeason?.id}
                  isManager={canEditTrucks}
                  weekMonday={weekMonday}
                  totalPlanKg={totalPlan}
                  dayTotals={dayPlanTotals}
                  showSunday={showSunday}
                />
              ),
            },
          ]}
        />
      )}

      {/* Cell history modal */}
      <CellHistoryModal
        entry={historyEntry}
        onClose={() => setHistoryEntry(null)}
      />

      {/* Late-edit extension modal (admin only) */}
      <GrantExtensionModal
        open={extensionModalOpen}
        isSubmitting={bulkGrant.isPending}
        onConfirm={handleBulkGrant}
        onClose={() => setExtensionModalOpen(false)}
      />
    </div>
  );
}
