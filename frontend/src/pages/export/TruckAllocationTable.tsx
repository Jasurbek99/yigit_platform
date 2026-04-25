import { Table, InputNumber } from 'antd';
import type { TableColumnsType } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Dayjs } from 'dayjs';
import { handleCellKeyDown } from '@/utils/tableNavigation';
import {
  useTruckAllocations,
  useTruckDestinations,
  useUpsertTruckAllocation,
  useSetTruckSplits,
} from '@/hooks/usePlanning';
import type { DayOfWeek, IWeeklyHarvestPlan, IWeeklyTruckAllocation } from '@/types';
import { num, fmtKg } from './PlanCells';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

interface ITruckAllocationTableProps {
  plans: IWeeklyHarvestPlan[];
  weekNumber: number | undefined;
  year: number | undefined;
  seasonId: number | undefined;
  isManager: boolean;
  weekMonday: Dayjs;
  totalPlanKg: number;
}

export function TruckAllocationTable({
  plans,
  weekNumber,
  year,
  seasonId,
  isManager,
  weekMonday,
  totalPlanKg,
}: ITruckAllocationTableProps) {
  const { t } = useTranslation();
  const { data: truckData } = useTruckAllocations({
    season: seasonId, year, week_number: weekNumber,
  });
  const { data: destinations = [] } = useTruckDestinations();
  const upsertTruck = useUpsertTruckAllocation();
  const setTruckSplits = useSetTruckSplits();
  const truckAllocations: IWeeklyTruckAllocation[] = truckData?.results ?? [];

  if (destinations.length === 0) return null;

  const truckByDay = new Map(truckAllocations.map((a) => [a.day_of_week, a]));

  interface ITruckRow {
    key: string;
    label: string;
    type: 'computed' | 'editable';
    destId?: number;
  }

  const truckRows: ITruckRow[] = [
    { key: 'total_kg', label: t('plan.total_kg'), type: 'computed' },
    { key: 'total_trucks', label: t('plan.total_trucks_label'), type: 'computed' },
    ...destinations.map((d) => ({
      key: `dest_${d.id}`,
      label: d.name,
      type: 'editable' as const,
      destId: d.id,
    })),
  ];

  function handleTruckSave(dayOfWeek: DayOfWeek, destId: number, value: number) {
    const allocation = truckByDay.get(dayOfWeek);
    if (allocation) {
      setTruckSplits.mutate({
        allocationId: allocation.id,
        splits: [{ destination_id: destId, truck_count: value }],
      });
    } else if (seasonId) {
      upsertTruck.mutate(
        { season: seasonId, week_number: weekNumber!, year: year!, day_of_week: dayOfWeek, total_planned_kg: null },
        {
          onSuccess: (newAlloc) => {
            setTruckSplits.mutate({
              allocationId: newAlloc.id,
              splits: [{ destination_id: destId, truck_count: value }],
            });
          },
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
    ...DAYS.map((day, di) => ({
      title: (
        <div style={{ textAlign: 'center' as const, lineHeight: '16px' }}>
          <div>{t(`plan.${day}`)}</div>
          <div style={{ fontSize: 10, color: '#8c8c8c', fontWeight: 400 }}>
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
          if (row.key === 'total_kg') {
            const dayTotal = plans.reduce(
              (s, p) => s + num(p[`${day}_plan_kg` as keyof IWeeklyHarvestPlan]), 0,
            );
            return <strong style={{ color: '#1677ff' }}>{fmtKg(dayTotal)}</strong>;
          }
          const dayTotal = plans.reduce(
            (s, p) => s + num(p[`${day}_plan_kg` as keyof IWeeklyHarvestPlan]), 0,
          );
          const trucks = dayTotal > 0 ? Math.round(dayTotal / 18500) : 0;
          return <strong>{trucks}</strong>;
        }

        const destId = row.destId!;
        const split = allocation?.destination_splits?.find((s) => s.destination === destId);
        const currentVal = split?.truck_count ?? 0;

        if (isManager) {
          return (
            <InputNumber
              min={0}
              keyboard={false}
              defaultValue={currentVal}
              onBlur={(e) => {
                const v = Number(e.target.value.replace(/,/g, '')) || 0;
                if (v !== currentVal) handleTruckSave(dayOfWeek, destId, v);
              }}
              onKeyDown={handleCellKeyDown}
              size="small"
              style={{ width: 70 }}
            />
          );
        }
        return currentVal > 0 ? currentVal : <span style={{ color: '#bfbfbf' }}>—</span>;
      },
    })),
    {
      title: t('plan.total'),
      key: 'row_total',
      width: 80,
      render: (_: unknown, row: ITruckRow) => {
        if (row.key === 'total_kg') {
          return <strong style={{ color: '#1677ff' }}>{fmtKg(totalPlanKg)}</strong>;
        }
        if (row.key === 'total_trucks') {
          return <strong>{totalPlanKg > 0 ? Math.round(totalPlanKg / 18500) : 0}</strong>;
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

  return (
    <Table
      columns={truckColumns}
      dataSource={truckRows}
      rowKey="key"
      bordered
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
      onRow={(row) => ({
        style: row.type === 'editable'
          ? { backgroundColor: '#fff7e6' }
          : { backgroundColor: '#fafafa' },
      })}
    />
  );
}
