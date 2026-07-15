import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Alert, Select, Space, Table, InputNumber, Tooltip } from 'antd';
import type { TableColumnsType } from 'antd';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { Dayjs } from 'dayjs';
import { handleCellKeyDown } from '@/utils/tableNavigation';
import {
  useTruckAllocations,
  useTruckDestinations,
  useTruckDestinationSelection,
  useSetTruckDestinationSelection,
  useUpsertTruckAllocation,
  useSetTruckSplits,
} from '@/hooks/usePlanning';
import type { DayOfWeek, IWeeklyHarvestPlan, IWeeklyTruckAllocation } from '@/types';
import { fmtKg } from '@/components/HarvestCell.helpers';
import { COLORS } from '@/constants/styles';

const TRUCK_CAPACITY_KG = 18500;
const trucksFromKg = (kg: number): number => (kg > 0 ? Math.round(kg / TRUCK_CAPACITY_KG) : 0);

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

type InputNumberRef = ComponentRef<typeof InputNumber>;

interface ITruckSplitCellProps {
  value: number;
  canEdit: boolean;
  onSave: (value: number) => void;
}

/**
 * Click-to-edit truck-count cell, mirroring the weekly-plan HarvestCell:
 * shows the value as text; click reveals the input; blur saves and returns
 * to display mode (so editing again requires another click).
 */
function TruckSplitCell({ value, canEdit, onSave }: ITruckSplitCellProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<InputNumberRef>(null);

  // autoFocus is unreliable inside Table cells; focus imperatively on enter-edit.
  useEffect(() => {
    if (editing) inputRef.current?.focus({ cursor: 'all' });
  }, [editing]);

  if (canEdit && editing) {
    return (
      <InputNumber
        ref={inputRef}
        min={0}
        keyboard={false}
        defaultValue={value}
        onBlur={(e) => {
          const v = Number(e.target.value.replace(/,/g, '')) || 0;
          setEditing(false);
          if (v !== value) onSave(v);
        }}
        onKeyDown={handleCellKeyDown}
        size="small"
        style={{ width: 70 }}
      />
    );
  }

  return (
    <div
      data-edit-cell={canEdit ? 'true' : undefined}
      onClick={() => { if (canEdit) setEditing(true); }}
      style={{ cursor: canEdit ? 'text' : 'default', minHeight: 24, padding: '2px 0' }}
    >
      {value > 0 ? value : <span style={{ color: COLORS.textMuted }}>—</span>}
    </div>
  );
}

interface ITruckAllocationTableProps {
  plans: IWeeklyHarvestPlan[];
  weekNumber: number | undefined;
  year: number | undefined;
  seasonId: number | undefined;
  isManager: boolean;
  weekMonday: Dayjs;
  totalPlanKg: number;
  /** Per-day plan kg totals keyed by ISO date string (YYYY-MM-DD). */
  dayTotals?: Record<string, number>;
  /** When false (default), the Sunday column is hidden to save width. */
  showSunday?: boolean;
}

export function TruckAllocationTable({
  plans: _plans,
  weekNumber,
  year,
  seasonId,
  isManager,
  weekMonday,
  totalPlanKg,
  dayTotals = {},
  showSunday = false,
}: ITruckAllocationTableProps) {
  const { t } = useTranslation();
  // Sunday is the last day, so slicing it off keeps every di index aligned
  // with day_of_week (di + 1) and the date offset.
  const days: (typeof DAYS)[number][] = showSunday ? [...DAYS] : DAYS.slice(0, 6);
  const { data: truckData } = useTruckAllocations({
    season: seasonId, year, week_number: weekNumber,
  });
  const { data: allDestinations = [] } = useTruckDestinations();
  const { data: savedSelection = [] } = useTruckDestinationSelection({
    season: seasonId, year, week_number: weekNumber,
  });
  const upsertTruck = useUpsertTruckAllocation();
  const setTruckSplits = useSetTruckSplits();
  const setSelection = useSetTruckDestinationSelection();
  const truckAllocations: IWeeklyTruckAllocation[] = truckData?.results ?? [];

  const truckByDay = useMemo(
    () => new Map(truckAllocations.map((a) => [a.day_of_week, a])),
    [truckAllocations],
  );

  // Resolve which destinations show as rows: the week's saved selection, or the
  // is_default set when the week has none saved yet. Ordered by the destination
  // list's own sort_order (the API returns it pre-sorted).
  const selectedIds = useMemo(() => {
    const ids = savedSelection.length
      ? new Set(savedSelection.map((s) => s.destination))
      : new Set(allDestinations.filter((d) => d.is_default).map((d) => d.id));
    return ids;
  }, [savedSelection, allDestinations]);

  const selectedDestinations = useMemo(
    () => allDestinations.filter((d) => selectedIds.has(d.id)),
    [allDestinations, selectedIds],
  );

  // Per-day planned trucks (sum of selected splits) vs capacity (kg / 18500).
  const visibleDayCount = days.length;
  const dayWarnings = useMemo(() => {
    const map = new Map<DayOfWeek, { planned: number; capacity: number; over: boolean }>();
    for (let di = 0; di < visibleDayCount; di += 1) {
      const dow = (di + 1) as DayOfWeek;
      const allocation = truckByDay.get(dow);
      const planned = (allocation?.destination_splits ?? [])
        .filter((s) => selectedIds.has(s.destination))
        .reduce((sum, s) => sum + (s.truck_count ?? 0), 0);
      const colDate = weekMonday.add(di, 'day').format('YYYY-MM-DD');
      const capacity = trucksFromKg(dayTotals[colDate] ?? 0);
      map.set(dow, { planned, capacity, over: planned > capacity });
    }
    return map;
  }, [truckByDay, selectedIds, dayTotals, weekMonday, visibleDayCount]);

  // Week totals are the sums of the (visible) per-day values, so the row-total
  // always equals the sum of its own day cells and the week warning can never
  // contradict the per-day cells (sum(round(x)) != round(sum(x))).
  const weekPlannedTrucks = useMemo(
    () => Array.from(dayWarnings.values()).reduce((sum, d) => sum + d.planned, 0),
    [dayWarnings],
  );
  const weekCapacityTrucks = useMemo(
    () => Array.from(dayWarnings.values()).reduce((sum, d) => sum + d.capacity, 0),
    [dayWarnings],
  );
  const weekOver = weekPlannedTrucks > weekCapacityTrucks;
  const overDays = useMemo(
    () => Array.from(dayWarnings.entries()).filter(([, d]) => d.over).map(([dow]) => dow),
    [dayWarnings],
  );

  function handleSelectionChange(ids: number[]) {
    if (!seasonId || !weekNumber || !year) return;
    setSelection.mutate(
      { season: seasonId, year, week_number: weekNumber, destination_ids: ids },
      {
        onSuccess: () => toast.success(t('plan.toast_dest_saved')),
        onError: () => toast.error(t('plan.toast_truck_error')),
      },
    );
  }

  if (allDestinations.length === 0) return null;

  interface ITruckRow {
    key: string;
    label: string;
    type: 'computed' | 'planned' | 'editable';
    destId?: number;
  }

  const truckRows: ITruckRow[] = [
    { key: 'total_kg', label: t('plan.total_kg'), type: 'computed' },
    { key: 'total_trucks', label: t('plan.total_trucks_label'), type: 'computed' },
    { key: 'planned_trucks', label: t('plan.planned_trucks_label'), type: 'planned' },
    ...selectedDestinations.map((d) => ({
      key: `dest_${d.id}`,
      label: d.name,
      type: 'editable' as const,
      destId: d.id,
    })),
  ];

  function saveSplits(allocationId: number, destId: number, value: number) {
    setTruckSplits.mutate(
      { allocationId, splits: [{ destination_id: destId, truck_count: value }] },
      {
        onSuccess: () => toast.success(t('plan.toast_truck_saved')),
        onError: () => toast.error(t('plan.toast_truck_error')),
      },
    );
  }

  function handleTruckSave(dayOfWeek: DayOfWeek, destId: number, value: number) {
    const allocation = truckByDay.get(dayOfWeek);
    if (allocation) {
      saveSplits(allocation.id, destId, value);
    } else if (seasonId) {
      upsertTruck.mutate(
        { season: seasonId, week_number: weekNumber!, year: year!, day_of_week: dayOfWeek, total_planned_kg: null },
        {
          onSuccess: (newAlloc) => saveSplits(newAlloc.id, destId, value),
          onError: () => toast.error(t('plan.toast_truck_error')),
        },
      );
    }
  }

  const truckColumns: TableColumnsType<ITruckRow> = [
    {
      title: '',
      dataIndex: 'label',
      key: 'label',
      width: 120,
      fixed: 'left',
      render: (text: string) => <strong>{text}</strong>,
    },
    ...days.map((day, di) => ({
      title: (
        <div style={{ textAlign: 'center' as const, lineHeight: '16px' }}>
          <div>{t(`plan.${day}`)}</div>
          <div style={{ fontSize: 10, color: COLORS.textSecondary, fontWeight: 400 }}>
            {weekMonday.add(di, 'day').format('DD.MM')}
          </div>
        </div>
      ),
      key: day,
      width: 90,
      render: (_: unknown, row: ITruckRow) => {
        const dayOfWeek = (di + 1) as DayOfWeek;
        const allocation = truckByDay.get(dayOfWeek);

        if (row.type === 'computed') {
          const colDate = weekMonday.add(di, 'day').format('YYYY-MM-DD');
          const dayTotal = dayTotals[colDate] ?? 0;
          if (row.key === 'total_kg') {
            return <strong style={{ color: COLORS.primary }}>{fmtKg(dayTotal || null)}</strong>;
          }
          return <strong>{trucksFromKg(dayTotal)}</strong>;
        }

        if (row.type === 'planned') {
          const info = dayWarnings.get(dayOfWeek);
          if (!info || info.planned === 0) {
            return <span style={{ color: COLORS.textMuted }}>—</span>;
          }
          const cell = <strong style={{ color: info.over ? COLORS.danger : undefined }}>{info.planned}</strong>;
          return info.over ? (
            <Tooltip title={t('plan.over_alloc_cell', { planned: info.planned, capacity: info.capacity })}>
              {cell}
            </Tooltip>
          ) : cell;
        }

        const destId = row.destId!;
        const split = allocation?.destination_splits?.find((s) => s.destination === destId);
        const currentVal = split?.truck_count ?? 0;

        return (
          <TruckSplitCell
            // Remount on value change so the input re-seeds its defaultValue
            // after a save (matches the read-from-query display in HarvestCell).
            key={`${dayOfWeek}-${destId}-${currentVal}`}
            value={currentVal}
            canEdit={isManager}
            onSave={(v) => handleTruckSave(dayOfWeek, destId, v)}
          />
        );
      },
    })),
    {
      title: t('plan.total'),
      key: 'row_total',
      width: 80,
      render: (_: unknown, row: ITruckRow) => {
        if (row.key === 'total_kg') {
          return <strong style={{ color: COLORS.primary }}>{fmtKg(totalPlanKg)}</strong>;
        }
        if (row.key === 'total_trucks') {
          return <strong>{weekCapacityTrucks}</strong>;
        }
        if (row.key === 'planned_trucks') {
          return <strong style={{ color: weekOver ? COLORS.danger : undefined }}>{weekPlannedTrucks}</strong>;
        }
        const destId = row.destId!;
        const total = truckAllocations.reduce((s, a) => {
          const split = a.destination_splits?.find((sp) => sp.destination === destId);
          return s + (split?.truck_count ?? 0);
        }, 0);
        return <strong>{total}</strong>;
      },
    },
  ];

  const dayLabels = DAYS.map((d) => t(`plan.${d}`));
  const overDayDetails = overDays
    .map((dow) => {
      const info = dayWarnings.get(dow)!;
      return `${dayLabels[dow - 1]} (${info.planned}/${info.capacity})`;
    })
    .join(', ');

  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      {isManager && (
        <Select
          mode="multiple"
          size="small"
          value={selectedDestinations.map((d) => d.id)}
          onChange={handleSelectionChange}
          loading={setSelection.isPending}
          placeholder={t('plan.dest_select_placeholder')}
          style={{ minWidth: 280, maxWidth: '100%' }}
          options={allDestinations.map((d) => ({ value: d.id, label: d.name }))}
        />
      )}
      {overDays.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('plan.over_alloc_week', { days: overDayDetails })}
        />
      )}
      <Table
        columns={truckColumns}
        dataSource={truckRows}
        rowKey="key"
        bordered
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        onRow={(row) => {
          if (row.type === 'editable') return { style: { backgroundColor: COLORS.bgOrange } };
          if (row.key === 'planned_trucks' && weekOver) return { style: { backgroundColor: COLORS.bgRed } };
          return { style: { backgroundColor: COLORS.bgLayout } };
        }}
      />
    </Space>
  );
}
