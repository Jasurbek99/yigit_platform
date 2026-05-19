import { useMemo, useState } from 'react';
// NOTE: Plain Table (not ProTable) is intentional here — this is a custom
// dates×firms cross-tab matrix with dynamic columns, not a standard data list.
import {
  Alert,
  Button,
  DatePicker,
  Flex,
  InputNumber,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { toast } from 'sonner';
import {
  CheckCircleOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { useAdminFirms } from '@/hooks/useAdmin';
import {
  useQuotaUsageRecords,
  useUpdateQuotaUsage,
  useCreateQuotaUsage,
  useBulkApproveQuotaUsage,
} from '@/hooks/useQuotaUsage';
import { handleCellKeyDown } from '@/utils/tableNavigation';
import { fmtWeight, type WeightUnit } from '@/utils/weight';
import type { IQuotaUsageRecord, IExportFirm } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

const TRUCK_CAPACITY_KG = 18_500;

interface IGridRow {
  key: string;
  date: string;           // YYYY-MM-DD
  dateDisplay: string;    // DD.MM.YYYY
  [firmKey: string]: string | number | null | undefined;
}

/** Safely coerce to number. */
function num(val: unknown): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

/** Build a lookup key for record by date+firm. */
function recordKey(date: string, firmId: number): string {
  return `${date}_${firmId}`;
}

interface IQuotaUsageGridProps {
  weightUnit: WeightUnit;
  productType: string;
}

export function QuotaUsageGrid({ weightUnit, productType }: IQuotaUsageGridProps) {
  const fmtW = (val: number | null | undefined): string => {
    if (val == null || val === 0) return '';
    return fmtWeight(val, weightUnit);
  };
  const { t } = useTranslation();
  const { user } = useAuth();
  const canEdit = canDo(user, 'quota_usage', 'edit');
  const canCreate = canDo(user, 'quota_usage', 'create');

  // Month picker — default to current month
  const [selectedMonth, setSelectedMonth] = useState<Dayjs>(dayjs());
  // Manually added date rows (dates the user added via the "+" button)
  const [addedDates, setAddedDates] = useState<Set<string>>(new Set());

  const dateFrom = selectedMonth.startOf('month').format('YYYY-MM-DD');
  const dateTo = selectedMonth.endOf('month').format('YYYY-MM-DD');

  const { data: records = [], isLoading, isError } = useQuotaUsageRecords({
    date_from: dateFrom,
    date_to: dateTo,
    product_type: productType,
  });
  const { data: firms = [] } = useAdminFirms();
  const updateMutation = useUpdateQuotaUsage();
  const createMutation = useCreateQuotaUsage();
  const approveMutation = useBulkApproveQuotaUsage();

  // Build a record lookup: date+firmId → record
  const recordMap = useMemo(() => {
    const map = new Map<string, IQuotaUsageRecord>();
    for (const r of records) {
      map.set(recordKey(r.usage_date, r.export_firm), r);
    }
    return map;
  }, [records]);

  // Show all active firms as columns (users can enter data for any firm)
  const gridFirms: IExportFirm[] = useMemo(() => {
    if (firms.length === 0) {
      // Fallback: derive firm info from records
      const firmMap = new Map<number, string>();
      for (const r of records) {
        if (!firmMap.has(r.export_firm)) {
          firmMap.set(r.export_firm, r.export_firm_name);
        }
      }
      return Array.from(firmMap.entries())
        .map(([id, name]) => ({ id, name_tk: name } as IExportFirm))
        .sort((a, b) => a.name_tk.localeCompare(b.name_tk));
    }
    return firms
      .filter((f) => f.is_active)
      .sort((a, b) => a.name_tk.localeCompare(b.name_tk));
  }, [firms, records]);

  // Get firm display name
  function firmName(firm: IExportFirm): string {
    return firm.name_en || firm.name_tk || String(firm.id);
  }

  // Dates from existing records + manually added rows, sorted
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) set.add(r.usage_date);
    for (const d of addedDates) set.add(d);
    return Array.from(set).sort();
  }, [records, addedDates]);

  // Add the next day after the last existing row
  function handleAddRow() {
    const lastDate = dates.length > 0
      ? dayjs(dates[dates.length - 1])
      : selectedMonth.startOf('month').subtract(1, 'day');
    const nextDate = lastDate.add(1, 'day');
    // Don't go past end of selected month
    if (nextDate.month() !== selectedMonth.month() || nextDate.year() !== selectedMonth.year()) return;
    setAddedDates((prev) => new Set(prev).add(nextDate.format('YYYY-MM-DD')));
  }

  const canAddMore = (() => {
    const lastDate = dates.length > 0
      ? dayjs(dates[dates.length - 1])
      : selectedMonth.startOf('month').subtract(1, 'day');
    const nextDate = lastDate.add(1, 'day');
    return nextDate.month() === selectedMonth.month() && nextDate.year() === selectedMonth.year();
  })();

  // Build grid rows: one per date
  const gridData: IGridRow[] = useMemo(() => {
    return dates.map((date) => {
      const row: IGridRow = {
        key: date,
        date,
        dateDisplay: dayjs(date).format('DD.MM.YYYY'),
      };
      let rowTotal = 0;
      for (const firm of gridFirms) {
        const rec = recordMap.get(recordKey(date, firm.id));
        const val = rec ? num(rec.kg_used) : null;
        row[`firm_${firm.id}`] = val;
        rowTotal += num(val);
      }
      row._rowTotal = rowTotal;
      row._truckCount = rowTotal > 0 ? Math.round(rowTotal / TRUCK_CAPACITY_KG) : null;
      return row;
    });
  }, [dates, gridFirms, recordMap]);

  // Column totals (per firm)
  const columnTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const firm of gridFirms) {
      totals[`firm_${firm.id}`] = 0;
    }
    let grandTotal = 0;
    for (const row of gridData) {
      for (const firm of gridFirms) {
        const val = num(row[`firm_${firm.id}`]);
        totals[`firm_${firm.id}`] += val;
        grandTotal += val;
      }
    }
    totals._grandTotal = grandTotal;
    return totals;
  }, [gridData, gridFirms]);

  // Draft record IDs for bulk approve
  const draftIds = useMemo(
    () => records.filter((r) => r.status === 'draft').map((r) => r.id),
    [records],
  );

  // ─── Handlers ────────────────────────────────────────────────────────────

  function handleCellSave(date: string, firmId: number, newValue: number) {
    const rec = recordMap.get(recordKey(date, firmId));
    if (rec) {
      // Update existing record
      if (rec.status !== 'draft') return;
      if (num(rec.kg_used) === newValue) return;
      updateMutation.mutate(
        { id: rec.id, kg_used: newValue },
        { onError: () => toast.error(t('quota_usage.save_error')) },
      );
    } else if (newValue > 0 && canCreate) {
      // Create new record
      createMutation.mutate(
        { usage_date: date, export_firm: firmId, kg_used: newValue, product_type: productType },
        { onError: () => toast.error(t('quota_usage.save_error')) },
      );
    }
  }

  function handleBulkApprove() {
    if (!draftIds.length) return;
    approveMutation.mutate(draftIds, {
      onSuccess: (data) => {
        toast.success(t('quota_usage.approved_count', { count: data.approved }));
      },
    });
  }

  // ─── Columns ─────────────────────────────────────────────────────────────

  const firmColumns = gridFirms.map((firm) => ({
    title: (
      <div style={{ textAlign: 'center', fontSize: 11, lineHeight: '14px', whiteSpace: 'normal', maxWidth: 80 }}>
        {firmName(firm)}
      </div>
    ),
    key: `firm_${firm.id}`,
    width: 100,
    align: 'right' as const,
    render: (_: unknown, row: IGridRow) => {
      const rec = recordMap.get(recordKey(row.date, firm.id));
      const value = row[`firm_${firm.id}`] as number | null;
      const isDraft = rec?.status === 'draft';
      const isEditable = (isDraft && canEdit) || (!rec && canCreate);

      if (isEditable) {
        return (
          <InputNumber
            key={`${row.date}_${firm.id}_${value}`}
            min={0}
            step={100}
            keyboard={false}
            defaultValue={value ?? undefined}
            placeholder=""
            suffix="kg"
            onBlur={(e) => {
              const raw = e.target.value.replace(/,/g, '');
              const v = raw === '' ? 0 : Number(raw) || 0;
              const oldVal = num(value);
              if (v !== oldVal) handleCellSave(row.date, firm.id, v);
            }}
            onKeyDown={handleCellKeyDown}
            size="small"
            style={{ width: 84 }}
            formatter={(val) => (val ? `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '')}
          />
        );
      }

      if (!value) return <span style={{ color: COLORS.borderLight }}>—</span>;

      return (
        <span>
          {fmtW(value)}
          {rec?.status === 'approved' && (
            <CheckCircleOutlined style={{ color: COLORS.success, fontSize: 10, marginLeft: 4 }} />
          )}
        </span>
      );
    },
  }));

  const columns: TableColumnsType<IGridRow> = [
    {
      title: t('quota_usage.date'),
      dataIndex: 'dateDisplay',
      key: 'date',
      fixed: 'left',
      width: 100,
      render: (text: string) => <Text strong>{text}</Text>,
    },
    ...firmColumns,
    {
      title: t('quota_usage.grid_row_total'),
      key: '_rowTotal',
      width: 110,
      align: 'right' as const,
      fixed: 'right',
      render: (_: unknown, row: IGridRow) => {
        const total = num(row._rowTotal);
        return total > 0 ? (
          <Text strong style={{ color: COLORS.primary }}>{fmtW(total)}</Text>
        ) : (
          <span style={{ color: COLORS.borderLight }}>—</span>
        );
      },
    },
    {
      title: t('quota_usage.grid_truck_count'),
      key: '_truckCount',
      width: 70,
      align: 'center' as const,
      fixed: 'right',
      render: (_: unknown, row: IGridRow) => {
        const count = row._truckCount as number | null;
        return count ? <Tag color="purple">{count}</Tag> : null;
      },
    },
  ];

  // ─── Summary row ─────────────────────────────────────────────────────────

  function renderSummary() {
    const grandTotal = columnTotals._grandTotal ?? 0;
    const grandTrucks = grandTotal > 0 ? Math.round(grandTotal / TRUCK_CAPACITY_KG) : 0;
    return (
      <Table.Summary.Row style={{ fontWeight: 600 }}>
        <Table.Summary.Cell index={0}>
          <Text strong>{t('quota_usage.grid_total')}</Text>
        </Table.Summary.Cell>
        {gridFirms.map((firm, i) => (
          <Table.Summary.Cell key={firm.id} index={i + 1} align="right">
            <span style={{ color: COLORS.primary }}>
              {fmtW(columnTotals[`firm_${firm.id}`])}
            </span>
          </Table.Summary.Cell>
        ))}
        <Table.Summary.Cell index={gridFirms.length + 1} align="right">
          <Text strong style={{ color: COLORS.primary }}>{fmtW(grandTotal)}</Text>
        </Table.Summary.Cell>
        <Table.Summary.Cell index={gridFirms.length + 2} align="center">
          {grandTrucks > 0 && <Tag color="purple">{grandTrucks}</Tag>}
        </Table.Summary.Cell>
      </Table.Summary.Row>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Toolbar */}
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Space>
          <Button
            icon={<LeftOutlined />}
            onClick={() => { setSelectedMonth((m) => m.subtract(1, 'month')); setAddedDates(new Set()); }}
            aria-label={t('quota_usage.prev_month')}
          />
          <DatePicker
            picker="month"
            value={selectedMonth}
            onChange={(d) => { if (d) { setSelectedMonth(d); setAddedDates(new Set()); } }}
            allowClear={false}
            style={{ width: 160 }}
          />
          <Button
            icon={<RightOutlined />}
            onClick={() => { setSelectedMonth((m) => m.add(1, 'month')); setAddedDates(new Set()); }}
            aria-label={t('quota_usage.next_month')}
          />
          {canCreate && canAddMore && (
            <Button icon={<PlusOutlined />} size="small" onClick={handleAddRow}>
              {t('quota_usage.grid_add_row')}
            </Button>
          )}
          <Text type="secondary">
            {t('quota_usage.total_records', { count: records.length })}
            {draftIds.length > 0 && ` · ${draftIds.length} ${t('quota_usage.pending')}`}
          </Text>
        </Space>

        {canEdit && draftIds.length > 0 && (
          <Button
            type="primary"
            icon={<CheckCircleOutlined />}
            onClick={handleBulkApprove}
            loading={approveMutation.isPending}
          >
            {t('quota_usage.approve')} ({draftIds.length})
          </Button>
        )}
      </Flex>

      {isError && (
        <Alert type="error" message={t('quota_usage.load_error')} style={{ marginBottom: 12 }} />
      )}

      {gridData.length === 0 && !isLoading ? (
        <Alert type="info" message={t('quota_usage.grid_empty')} style={{ marginBottom: 12 }} />
      ) : (
        <Table<IGridRow>
          columns={columns}
          dataSource={gridData}
          rowKey="key"
          bordered
          size="small"
          loading={isLoading}
          scroll={{ x: 'max-content' }}
          pagination={false}
          summary={gridData.length > 0 ? renderSummary : undefined}
        />
      )}
    </div>
  );
}
