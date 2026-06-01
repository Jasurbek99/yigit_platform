import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Checkbox, Flex, Input, Modal, Select, Segmented, Tag, Tooltip, Typography } from 'antd';
import { PlusOutlined, DownloadOutlined, EditOutlined, FilterOutlined, DeleteOutlined, ExclamationCircleFilled } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns, ColumnsState } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import api from '@/services/api';
import { StatusTag } from '@/components/StatusTag';
import { ShipmentCreateModal } from '@/components/ShipmentCreateModal';
import { ShipmentEditDrawerForId } from '@/components/ShipmentEditDrawerForId';
import { ShipmentBulkTransitionModal } from '@/components/ShipmentBulkTransitionModal';
import { ShipmentFilterDrawer } from '@/components/ShipmentFilterDrawer';
import { useShipments } from '@/hooks/useShipments';
import { useAuth } from '@/hooks/useAuth';
import { canDo, canEditField } from '@/utils/permissions';
import { COLORS, FONT } from '@/constants/styles';
import type { IShipmentListItem } from '@/types';
import { ListEditableCell } from './ListEditableCell';

const { Title, Text } = Typography;

type ViewMode = 'all' | 'my_work' | 'archive';

// Roles allowed to switch into the Archive view. Mirrors the backend gate in
// ShipmentViewSet._ARCHIVE_VIEW_ROLES — keep these two lists in sync.
const ARCHIVE_VIEW_ROLES: ReadonlyArray<string> = [
  'admin',
  'director',
  'export_manager',
  'finansist',
  'boss',
];

const COUNTRY_FLAGS: Record<string, string> = {
  kazakhstan: '🇰🇿',
  gazagystan: '🇰🇿',
  russia: '🇷🇺',
  rossiya: '🇷🇺',
  uzbekistan: '🇺🇿',
  özbegistan: '🇺🇿',
  belarus: '🇧🇾',
  belarusiya: '🇧🇾',
};

function withFlag(name: string | null): string {
  if (!name) return '—';
  const flag = COUNTRY_FLAGS[name.toLowerCase()] ?? '';
  return flag ? `${flag} ${name}` : name;
}

// ─── Cell render helpers (shared by the opt-in Sheet-parity columns) ─────────
const mutedDash = <span style={{ color: COLORS.textMuted }}>—</span>;

function renderText(value: string | null | undefined): React.ReactNode {
  return value ? value : mutedDash;
}

function renderMono(value: string | null | undefined): React.ReactNode {
  return value ? (
    <span style={{ fontFamily: FONT.mono, fontSize: 12 }}>{value}</span>
  ) : mutedDash;
}

function renderNumber(value: number | null | undefined): React.ReactNode {
  return value != null ? (
    <span style={{ fontFamily: FONT.mono }}>{Number(value).toLocaleString()}</span>
  ) : mutedDash;
}

function renderDate(value: string | null | undefined): React.ReactNode {
  return value ? (
    <span style={{ fontFamily: FONT.mono, fontSize: 12 }}>{dayjs(value).format('DD.MM.YYYY')}</span>
  ) : mutedDash;
}

function renderDateTime(value: string | null | undefined): React.ReactNode {
  return value ? (
    <span style={{ fontFamily: FONT.mono, color: COLORS.textSecondary, fontSize: 12 }}>
      {dayjs(value).format('DD.MM.YY HH:mm')}
    </span>
  ) : mutedDash;
}

function renderBool(value: boolean): React.ReactNode {
  return value ? <Tag color="green">✓</Tag> : mutedDash;
}

// Status-filter buckets. Values are ShipmentStatusType.phase values from the DB
// (DDL v5.1 / migration 0010), NOT status codes — the list endpoint filters
// `status__phase=<value>`. Ordered to follow the workflow. CANCELLED is omitted
// here; cancelled shipments are toggled via the dedicated "show cancelled" box.
const PHASE_KEYS = [
  'DRAFT', 'CUSTOMS', 'LOADING', 'TRANSIT', 'BORDER', 'SALES', 'COMPLETE',
] as const;

// localStorage key for the per-user column layout (visibility + order + pin).
// ProTable's ColumnSetting writes/reads this map automatically.
// NOTE: bump the version suffix whenever the default column set changes —
// ProTable merges stored state over `defaultValue`, so a stale entry would
// leave newly-added columns un-hidden (defaults don't override stored keys).
const COLUMN_STATE_KEY = 'ygt.shipmentList.columnsState.v2';

// Default column layout. Keys match each column's `key`/`dataIndex`. Columns
// absent from this map are shown by default; the ones below ship hidden so the
// out-of-the-box table matches the original 7-column view — users opt them in
// via the column settings (gear) panel, which also reorders and pins them.
const HIDDEN_BY_DEFAULT: ReadonlyArray<string> = [
  // Round-2 opt-in columns
  'date', 'official_export_code', 'weight_gross', 'city_name', 'variety_name',
  'border_point_name', 'price_per_kg', 'total_amount_usd', 'is_gapy_satys',
  // Sheet-parity opt-in columns
  'import_firm_name', 'variety_code',
  'packaging_kg', 'pallet_count', 'box_count', 'rejected_weight_kg',
  'vehicle_responsible_display', 'truck_plate', 'driver_name', 'driver_phone',
  'transport_temp_c', 'transit_days', 'has_peregruz', 'peregruz_city', 'peregruz_date',
  'customs_clearance_planned_day',
  'loading_started_at', 'loading_ended_at', 'customs_entry_at', 'customs_exit_at',
  'border_crossed_at', 'dest_entry_at', 'sale_started_at', 'sale_ended_at',
  'sales_report_date', 'harvest_date',
  'vehicle_condition', 'vehicle_condition_note', 'vehicle_live_status',
  'doc_azyk', 'doc_suriji', 'doc_hil', 'doc_kalibrowka',
  'notes', 'export_manager_note', 'warehouse_note', 'document_note', 'additional_notes_arap',
  'created_by_name', 'created_at',
];

const DEFAULT_COLUMN_STATE: Record<string, ColumnsState> = Object.fromEntries(
  HIDDEN_BY_DEFAULT.map((key) => [key, { show: false }]),
);

// SheetJS (`xlsx`) is ~900 kB raw / ~100 kB gzip. Importing it statically
// pulled the whole library into the ShipmentList page chunk, so it downloaded
// on every visit to the list even when no one exports. Load it on demand —
// only when the user actually clicks Excel.
async function exportToExcel(rows: IShipmentListItem[], t: (k: string) => string): Promise<void> {
  const XLSX = await import('xlsx');
  const sheetData = rows.map((r) => ({
    [t('shipments.cargo_code')]: r.cargo_code,
    [t('shipments.date')]: r.date ? dayjs(r.date).format('DD.MM.YYYY') : '',
    [t('shipments.status')]: r.status_display,
    [t('shipments.country')]: r.country_name ?? '',
    [t('shipments.customer')]: r.customer_name ?? '',
    [t('shipments.weight_net')]: r.weight_net ?? '',
    [t('shipments.departed')]: r.departed_at ? dayjs(r.departed_at).format('DD.MM.YY HH:mm') : '',
    [t('shipments.arrived')]: r.arrived_at ? dayjs(r.arrived_at).format('DD.MM.YY HH:mm') : '',
  }));
  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Shipments');
  XLSX.writeFile(wb, `shipments_${dayjs().format('YYYY-MM-DD')}.xlsx`);
}

export default function ShipmentList() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editShipmentId, setEditShipmentId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [bulkTransitionOpen, setBulkTransitionOpen] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const _viewParam = searchParams.get('view');
  const viewMode: ViewMode =
    _viewParam === 'my_work' ? 'my_work' :
    _viewParam === 'archive' ? 'archive' :
    'all';
  const isArchiveView = viewMode === 'archive';
  const canSeeArchive = !!user && (
    user.is_superuser || ARCHIVE_VIEW_ROLES.includes(user.role)
  );
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('pageSize')) || 50;
  const search = searchParams.get('search') ?? '';
  const phaseFilter = searchParams.get('phase') ?? undefined;
  const countryFilter = Number(searchParams.get('country')) || undefined;
  const customerFilter = Number(searchParams.get('customer')) || undefined;
  const exportFirmFilter = Number(searchParams.get('export_firm')) || undefined;
  const dateAfter = searchParams.get('date_after') ?? undefined;
  const dateBefore = searchParams.get('date_before') ?? undefined;
  const pendingMyFields = searchParams.get('pending_my_fields') === 'true';
  // Show cancelled filter — false by default so the active list stays clean.
  const showCancelled = searchParams.get('show_cancelled') === 'true';

  function updateParams(updates: Record<string, string | undefined>) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, val] of Object.entries(updates)) {
        if (val) next.set(key, val);
        else next.delete(key);
      }
      return next;
    });
  }

  function setPage(p: number) { updateParams({ page: p > 1 ? String(p) : undefined }); }
  function setPageSize(ps: number) { updateParams({ pageSize: ps !== 50 ? String(ps) : undefined, page: undefined }); }
  function setViewMode(v: ViewMode) { updateParams({ view: v !== 'all' ? v : undefined, page: undefined }); }
  function setSearch(s: string) { updateParams({ search: s || undefined, page: undefined }); }
  function setPhaseFilter(v: string | undefined) { updateParams({ phase: v, page: undefined }); }

  const canCreate = canDo(user, 'shipment', 'create');
  const canEditWeightNet = canEditField(user, 'shipment', 'weight_net');
  const canEditAnyField = canDo(user, 'shipment', 'edit');
  // Hard-delete is an admin-only escape hatch. Mirrors the backend gate in
  // ShipmentViewSet.bulk_delete — keep these two checks in sync. Destructive,
  // cascade-removes comments/status_log/firm_splits/block_sources/pallets.
  const canHardDelete = !!user && (user.is_superuser || user.role === 'admin');

  const { data, isLoading } = useShipments({
    page,
    page_size: pageSize,
    my_work: viewMode === 'my_work' || undefined,
    archived: isArchiveView || undefined,
    search: search || undefined,
    phase: phaseFilter,
    country: countryFilter,
    customer: customerFilter,
    export_firm: exportFirmFilter,
    date_after: dateAfter,
    date_before: dateBefore,
    pending_my_fields: pendingMyFields || undefined,
    show_cancelled: showCancelled || undefined,
  });

  const advancedFilterCount = [
    countryFilter,
    customerFilter,
    exportFirmFilter,
    dateAfter,
    dateBefore,
    pendingMyFields ? 'on' : undefined,
    showCancelled ? 'on' : undefined,
  ].filter(Boolean).length;

  function applyAdvancedFilters(values: {
    country?: number | null;
    customer?: number | null;
    export_firm?: number | null;
    date_after?: string | null;
    date_before?: string | null;
    pending_my_fields?: boolean;
  }) {
    updateParams({
      country: values.country ? String(values.country) : undefined,
      customer: values.customer ? String(values.customer) : undefined,
      export_firm: values.export_firm ? String(values.export_firm) : undefined,
      date_after: values.date_after ?? undefined,
      date_before: values.date_before ?? undefined,
      pending_my_fields: values.pending_my_fields ? 'true' : undefined,
      page: undefined,
    });
    setFilterDrawerOpen(false);
  }

  function clearAdvancedFilters() {
    updateParams({
      country: undefined,
      customer: undefined,
      export_firm: undefined,
      date_after: undefined,
      date_before: undefined,
      pending_my_fields: undefined,
      show_cancelled: undefined,
      page: undefined,
    });
  }

  function handleCreateSuccess() {
    void queryClient.invalidateQueries({ queryKey: ['shipments'] });
  }

  const [bulkDeleting, setBulkDeleting] = useState(false);

  function handleBulkDelete() {
    const ids = [...selectedRowKeys];
    if (ids.length === 0) return;
    Modal.confirm({
      title: t('shipment_bulk.delete_confirm_title', { count: ids.length }),
      icon: <ExclamationCircleFilled style={{ color: '#ff4d4f' }} />,
      content: t('shipment_bulk.delete_confirm_content'),
      okText: t('shipment_bulk.delete_confirm_ok'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      async onOk() {
        setBulkDeleting(true);
        try {
          const { data } = await api.post<{
            deleted: number;
            approved_quota_to_reconcile: number[];
          }>('/export/shipments/bulk-delete/', { ids });
          toast.success(t('shipment_bulk.delete_success', { count: data.deleted }));
          if (data.approved_quota_to_reconcile.length > 0) {
            toast.warning(
              t('shipment_bulk.delete_approved_quota_warning', {
                count: data.approved_quota_to_reconcile.length,
              }),
            );
          }
          setSelectedRowKeys([]);
          // Invalidate both list and detail caches in case any deleted IDs
          // are currently open in a detail view.
          void queryClient.invalidateQueries({ queryKey: ['shipments'] });
          void queryClient.invalidateQueries({ queryKey: ['shipment'] });
        } catch (err) {
          console.error('[ShipmentList] bulk delete failed', err);
          toast.error(t('shipment_bulk.delete_error'));
        } finally {
          setBulkDeleting(false);
        }
      },
    });
  }

  const baseColumns: ProColumns<IShipmentListItem>[] = [
    {
      title: t('common.row_no'),
      key: 'row_no',
      width: 56,
      fixed: 'left',
      align: 'center',
      hideInSetting: true,
      render: (_, __, index) => (
        <span style={{ color: '#98a2b3', fontVariantNumeric: 'tabular-nums' }}>
          {(page - 1) * pageSize + index + 1}
        </span>
      ),
    },
    {
      title: t('shipments.cargo_code'),
      dataIndex: 'cargo_code',
      key: 'cargo_code',
      width: 140,
      render: (_, record) => (
        <span
          style={{
            fontFamily: FONT.mono,
            color: COLORS.primary,
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {record.cargo_code}
        </span>
      ),
    },
    {
      title: t('shipments.customer'),
      dataIndex: 'customer_name',
      key: 'customer_name',
      width: 150,
      render: (_, record) => record.customer_name ?? '—',
    },
    {
      title: t('shipments.country'),
      dataIndex: 'country_name',
      key: 'country_name',
      width: 130,
      render: (_, record) => withFlag(record.country_name ?? null),
    },
    {
      title: t('shipments.status'),
      dataIndex: 'status_display',
      key: 'status_display',
      width: 150,
      render: (_, record) => <StatusTag statusDisplay={record.status_display} />,
    },
    {
      title: t('shipments.weight_net'),
      dataIndex: 'weight_net',
      key: 'weight_net',
      width: 120,
      align: 'right',
      responsive: ['md'],
      render: (_, record) => {
        const display = record.weight_net != null ? (
          <span style={{ fontFamily: FONT.mono }}>
            {Number(record.weight_net).toLocaleString()}
          </span>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        );
        return (
          <ListEditableCell
            shipmentId={record.id}
            fieldKey="weight_net"
            value={record.weight_net}
            type="number"
            isEditable={canEditWeightNet && !isArchiveView}
            display={display}
          />
        );
      },
    },
    {
      title: t('shipments.departed'),
      dataIndex: 'departed_at',
      key: 'departed_at',
      width: 130,
      render: (_, record) =>
        record.departed_at ? (
          <span style={{ fontFamily: FONT.mono, color: COLORS.textSecondary, fontSize: 12 }}>
            {dayjs(record.departed_at).format('DD.MM.YY HH:mm')}
          </span>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        ),
    },
    {
      title: t('shipments.arrived'),
      dataIndex: 'arrived_at',
      key: 'arrived_at',
      width: 130,
      responsive: ['md'],
      render: (_, record) =>
        record.arrived_at ? (
          <span style={{ fontFamily: FONT.mono, color: COLORS.textSecondary, fontSize: 12 }}>
            {dayjs(record.arrived_at).format('DD.MM.YY HH:mm')}
          </span>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        ),
    },
    // ── Opt-in columns (hidden by default; toggled/reordered via the gear) ──
    {
      title: t('shipments.date'),
      dataIndex: 'date',
      key: 'date',
      width: 110,
      render: (_, record) =>
        record.date ? (
          <span style={{ fontFamily: FONT.mono, fontSize: 12 }}>
            {dayjs(record.date).format('DD.MM.YYYY')}
          </span>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        ),
    },
    {
      title: t('shipments.official_code'),
      dataIndex: 'official_export_code',
      key: 'official_export_code',
      width: 140,
      render: (_, record) =>
        record.official_export_code ? (
          <span style={{ fontFamily: FONT.mono, fontSize: 12 }}>{record.official_export_code}</span>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        ),
    },
    {
      title: t('shipments.weight_gross'),
      dataIndex: 'weight_gross',
      key: 'weight_gross',
      width: 120,
      align: 'right',
      render: (_, record) =>
        record.weight_gross != null ? (
          <span style={{ fontFamily: FONT.mono }}>{Number(record.weight_gross).toLocaleString()}</span>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        ),
    },
    {
      title: t('shipments.city'),
      dataIndex: 'city_name',
      key: 'city_name',
      width: 120,
      render: (_, record) => record.city_name ?? '—',
    },
    {
      title: t('shipments.variety'),
      dataIndex: 'variety_name',
      key: 'variety_name',
      width: 120,
      render: (_, record) => record.variety_name ?? '—',
    },
    {
      title: t('shipments.border_point'),
      dataIndex: 'border_point_name',
      key: 'border_point_name',
      width: 130,
      render: (_, record) => record.border_point_name ?? '—',
    },
    {
      title: t('shipments.price_per_kg'),
      dataIndex: 'price_per_kg',
      key: 'price_per_kg',
      width: 110,
      align: 'right',
      render: (_, record) =>
        record.price_per_kg != null ? (
          <span style={{ fontFamily: FONT.mono }}>{Number(record.price_per_kg).toLocaleString()}</span>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        ),
    },
    {
      title: t('shipments.total_usd'),
      dataIndex: 'total_amount_usd',
      key: 'total_amount_usd',
      width: 130,
      align: 'right',
      render: (_, record) =>
        record.total_amount_usd != null ? (
          <span style={{ fontFamily: FONT.mono }}>
            ${Number(record.total_amount_usd).toLocaleString()}
          </span>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        ),
    },
    {
      title: t('shipments.gapy_satys'),
      dataIndex: 'is_gapy_satys',
      key: 'is_gapy_satys',
      width: 110,
      render: (_, record) =>
        record.is_gapy_satys ? (
          <Tag color="purple">{t('shipments.gapy_satys')}</Tag>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        ),
    },
    // Customer / product
    { title: t('shipments.import_firm'), dataIndex: 'import_firm_name', key: 'import_firm_name', width: 150, render: (_, r) => renderText(r.import_firm_name) },
    { title: t('shipments.variety_code'), dataIndex: 'variety_code', key: 'variety_code', width: 110, render: (_, r) => renderMono(r.variety_code) },
    // Weight detail
    { title: t('shipments.packaging_kg'), dataIndex: 'packaging_kg', key: 'packaging_kg', width: 120, align: 'right', render: (_, r) => renderNumber(r.packaging_kg) },
    { title: t('shipments.pallet_count'), dataIndex: 'pallet_count', key: 'pallet_count', width: 90, align: 'right', render: (_, r) => renderNumber(r.pallet_count) },
    { title: t('shipments.box_count'), dataIndex: 'box_count', key: 'box_count', width: 90, align: 'right', render: (_, r) => renderNumber(r.box_count) },
    { title: t('shipments.rejected_weight_kg'), dataIndex: 'rejected_weight_kg', key: 'rejected_weight_kg', width: 120, align: 'right', render: (_, r) => renderNumber(r.rejected_weight_kg) },
    // Transport
    { title: t('shipments.vehicle_responsible'), dataIndex: 'vehicle_responsible_display', key: 'vehicle_responsible_display', width: 150, render: (_, r) => renderText(r.vehicle_responsible_display) },
    { title: t('shipments.truck_plate'), dataIndex: 'truck_plate', key: 'truck_plate', width: 120, render: (_, r) => renderMono(r.truck_plate) },
    { title: t('shipments.driver_name'), dataIndex: 'driver_name', key: 'driver_name', width: 140, render: (_, r) => renderText(r.driver_name) },
    { title: t('shipments.driver_phone'), dataIndex: 'driver_phone', key: 'driver_phone', width: 140, render: (_, r) => renderMono(r.driver_phone) },
    { title: t('shipments.transport_temp_c'), dataIndex: 'transport_temp_c', key: 'transport_temp_c', width: 100, align: 'right', render: (_, r) => renderNumber(r.transport_temp_c) },
    { title: t('shipments.transit_days'), dataIndex: 'transit_days', key: 'transit_days', width: 100, align: 'right', render: (_, r) => renderNumber(r.transit_days) },
    { title: t('shipments.has_peregruz'), dataIndex: 'has_peregruz', key: 'has_peregruz', width: 100, render: (_, r) => renderBool(r.has_peregruz) },
    { title: t('shipments.peregruz_city'), dataIndex: 'peregruz_city', key: 'peregruz_city', width: 130, render: (_, r) => renderText(r.peregruz_city) },
    { title: t('shipments.peregruz_date'), dataIndex: 'peregruz_date', key: 'peregruz_date', width: 110, render: (_, r) => renderDate(r.peregruz_date) },
    { title: t('shipments.customs_planned_day'), dataIndex: 'customs_clearance_planned_day', key: 'customs_clearance_planned_day', width: 120, render: (_, r) => renderText(r.customs_clearance_planned_day) },
    // Timestamps
    { title: t('shipments.loading_started'), dataIndex: 'loading_started_at', key: 'loading_started_at', width: 130, render: (_, r) => renderDateTime(r.loading_started_at) },
    { title: t('shipments.loading_ended'), dataIndex: 'loading_ended_at', key: 'loading_ended_at', width: 130, render: (_, r) => renderDateTime(r.loading_ended_at) },
    { title: t('shipments.customs_entry'), dataIndex: 'customs_entry_at', key: 'customs_entry_at', width: 130, render: (_, r) => renderDateTime(r.customs_entry_at) },
    { title: t('shipments.customs_exit'), dataIndex: 'customs_exit_at', key: 'customs_exit_at', width: 130, render: (_, r) => renderDateTime(r.customs_exit_at) },
    { title: t('shipments.border_crossed'), dataIndex: 'border_crossed_at', key: 'border_crossed_at', width: 130, render: (_, r) => renderDateTime(r.border_crossed_at) },
    { title: t('shipments.dest_entry'), dataIndex: 'dest_entry_at', key: 'dest_entry_at', width: 130, render: (_, r) => renderDateTime(r.dest_entry_at) },
    { title: t('shipments.sale_started'), dataIndex: 'sale_started_at', key: 'sale_started_at', width: 130, render: (_, r) => renderDateTime(r.sale_started_at) },
    { title: t('shipments.sale_ended'), dataIndex: 'sale_ended_at', key: 'sale_ended_at', width: 130, render: (_, r) => renderDateTime(r.sale_ended_at) },
    { title: t('shipments.sales_report_date'), dataIndex: 'sales_report_date', key: 'sales_report_date', width: 120, render: (_, r) => renderDate(r.sales_report_date) },
    { title: t('shipments.harvest_date'), dataIndex: 'harvest_date', key: 'harvest_date', width: 120, render: (_, r) => renderDate(r.harvest_date) },
    // Vehicle condition (AD-2)
    { title: t('shipments.vehicle_condition'), dataIndex: 'vehicle_condition', key: 'vehicle_condition', width: 120, render: (_, r) => renderText(r.vehicle_condition) },
    { title: t('shipments.vehicle_condition_note'), dataIndex: 'vehicle_condition_note', key: 'vehicle_condition_note', width: 180, render: (_, r) => renderText(r.vehicle_condition_note) },
    { title: t('shipments.vehicle_live_status'), dataIndex: 'vehicle_live_status', key: 'vehicle_live_status', width: 160, render: (_, r) => renderText(r.vehicle_live_status) },
    // Quality docs
    { title: t('shipments.doc_azyk'), dataIndex: 'doc_azyk', key: 'doc_azyk', width: 100, render: (_, r) => renderBool(r.doc_azyk) },
    { title: t('shipments.doc_suriji'), dataIndex: 'doc_suriji', key: 'doc_suriji', width: 100, render: (_, r) => renderBool(r.doc_suriji) },
    { title: t('shipments.doc_hil'), dataIndex: 'doc_hil', key: 'doc_hil', width: 100, render: (_, r) => renderBool(r.doc_hil) },
    { title: t('shipments.doc_kalibrowka'), dataIndex: 'doc_kalibrowka', key: 'doc_kalibrowka', width: 110, render: (_, r) => renderBool(r.doc_kalibrowka) },
    // Notes
    { title: t('shipments.notes'), dataIndex: 'notes', key: 'notes', width: 200, ellipsis: true, render: (_, r) => renderText(r.notes) },
    { title: t('shipments.export_manager_note'), dataIndex: 'export_manager_note', key: 'export_manager_note', width: 200, ellipsis: true, render: (_, r) => renderText(r.export_manager_note) },
    { title: t('shipments.warehouse_note'), dataIndex: 'warehouse_note', key: 'warehouse_note', width: 200, ellipsis: true, render: (_, r) => renderText(r.warehouse_note) },
    { title: t('shipments.document_note'), dataIndex: 'document_note', key: 'document_note', width: 200, ellipsis: true, render: (_, r) => renderText(r.document_note) },
    { title: t('shipments.additional_notes_arap'), dataIndex: 'additional_notes_arap', key: 'additional_notes_arap', width: 200, ellipsis: true, render: (_, r) => renderText(r.additional_notes_arap) },
    // Audit
    { title: t('shipments.created_by'), dataIndex: 'created_by_name', key: 'created_by_name', width: 140, render: (_, r) => renderText(r.created_by_name) },
    { title: t('shipments.created_at'), dataIndex: 'created_at', key: 'created_at', width: 130, render: (_, r) => renderDateTime(r.created_at) },
    {
      title: '',
      key: '_actions',
      hideInSetting: true,
      width: 56,
      align: 'center',
      fixed: 'right',
      render: (_, record) => {
        if (!canEditAnyField) return null;
        // Archive view is read-only — no inline edits, no transitions, no
        // bulk actions. The row data still renders so management can audit
        // historical shipments without a separate page.
        if (isArchiveView) return null;
        return (
          <Tooltip title={t('common.edit')}>
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                setEditShipmentId(record.id);
              }}
            />
          </Tooltip>
        );
      },
    },
  ];

  // Opt-in (Sheet-parity) columns are hidden by default and md-up only, so
  // enabling one on mobile doesn't blow out the row. They're exactly the keys
  // in HIDDEN_BY_DEFAULT — inject `responsive` here rather than on each def.
  const hiddenKeys = new Set<string>(HIDDEN_BY_DEFAULT);
  const columns: ProColumns<IShipmentListItem>[] = baseColumns.map(
    (col): ProColumns<IShipmentListItem> =>
      hiddenKeys.has((col.key as string) ?? '')
        ? { ...col, responsive: ['md'] }
        : col,
  );

  return (
    <div>
      {/* Page header */}
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0, letterSpacing: '-0.02em' }}>
            {t('shipments.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {data
              ? t('shipments.subtitle_with_count', { count: data.count })
              : t('shipments.season_label')}
          </Text>
        </div>
        {canCreate && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsCreateModalOpen(true)}
          >
            {t('shipment_create.title')}
          </Button>
        )}
      </Flex>

      {/* Filter bar */}
      <Flex gap={8} wrap="wrap" align="center" style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder={t('shipments.search_ph')}
          style={{ width: 220 }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          onSearch={(val) => { setSearch(val); setPage(1); }}
          allowClear
        />
        <Select
          style={{ width: 160 }}
          placeholder={t('shipments.status_filter_ph')}
          value={phaseFilter}
          onChange={(val) => { setPhaseFilter(val ?? undefined); setPage(1); }}
          options={PHASE_KEYS.map((key) => ({ value: key, label: t(`phases.${key}`) }))}
          allowClear
        />
        <Checkbox
          checked={showCancelled}
          onChange={(e) => {
            updateParams({ show_cancelled: e.target.checked ? 'true' : undefined, page: undefined });
          }}
        >
          {t('shipments.show_cancelled')}
        </Checkbox>
        <Segmented
          value={viewMode}
          options={[
            { label: t('shipments.all'), value: 'all' },
            { label: t('shipments.my_work'), value: 'my_work' },
            // Archive only renders for management roles (mirrors backend gate).
            ...(canSeeArchive
              ? [{ label: t('shipments.archive'), value: 'archive' }]
              : []),
          ]}
          onChange={(val) => {
            const next: ViewMode =
              val === 'my_work' ? 'my_work' :
              val === 'archive' ? 'archive' :
              'all';
            setViewMode(next);
            setPage(1);
          }}
        />
        <Button
          icon={<FilterOutlined />}
          onClick={() => setFilterDrawerOpen(true)}
          style={{ marginLeft: 'auto' }}
          type={advancedFilterCount > 0 ? 'primary' : 'default'}
          ghost={advancedFilterCount > 0}
        >
          {advancedFilterCount > 0
            ? t('shipment_filter_drawer.button_with_count', { count: advancedFilterCount })
            : t('shipment_filter_drawer.button')}
        </Button>
        <Button
          icon={<DownloadOutlined />}
          onClick={() => {
            void exportToExcel(data?.results ?? [], t).catch((err) => {
              console.error('[ShipmentList] Excel export failed', err);
              toast.error(t('shipments.export_failed'));
            });
          }}
        >
          Excel
        </Button>
      </Flex>

      {/* Active advanced filter chips */}
      {advancedFilterCount > 0 && (
        <Flex gap={6} wrap="wrap" style={{ marginBottom: 12 }}>
          {dateAfter && (
            <Tag closable onClose={() => updateParams({ date_after: undefined, page: undefined })}>
              {t('shipment_filter_drawer.chip_date_after', { date: dateAfter })}
            </Tag>
          )}
          {dateBefore && (
            <Tag closable onClose={() => updateParams({ date_before: undefined, page: undefined })}>
              {t('shipment_filter_drawer.chip_date_before', { date: dateBefore })}
            </Tag>
          )}
          {countryFilter && (
            <Tag closable onClose={() => updateParams({ country: undefined, page: undefined })}>
              {t('shipment_filter_drawer.chip_country')}
            </Tag>
          )}
          {customerFilter && (
            <Tag closable onClose={() => updateParams({ customer: undefined, page: undefined })}>
              {t('shipment_filter_drawer.chip_customer')}
            </Tag>
          )}
          {exportFirmFilter && (
            <Tag closable onClose={() => updateParams({ export_firm: undefined, page: undefined })}>
              {t('shipment_filter_drawer.chip_firm')}
            </Tag>
          )}
          {pendingMyFields && (
            <Tag closable onClose={() => updateParams({ pending_my_fields: undefined, page: undefined })}>
              {t('shipment_filter_drawer.chip_pending')}
            </Tag>
          )}
          {showCancelled && (
            <Tag
              color="red"
              closable
              onClose={() => updateParams({ show_cancelled: undefined, page: undefined })}
            >
              {t('shipments.chip_show_cancelled')}
            </Tag>
          )}
          <Button size="small" type="link" onClick={clearAdvancedFilters}>
            {t('shipment_filter_drawer.clear_all')}
          </Button>
        </Flex>
      )}

      {/* Bulk action bar — only when rows selected */}
      {selectedRowKeys.length > 0 && (
        <Flex
          gap={8}
          align="center"
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: '#f0f5ff',
            border: '1px solid #adc6ff',
            borderRadius: 6,
          }}
        >
          <Text strong style={{ fontSize: 13 }}>
            {t('shipment_bulk.selected_count', { count: selectedRowKeys.length })}
          </Text>
          {canEditAnyField && (
            <Button
              size="small"
              type="primary"
              onClick={() => setBulkTransitionOpen(true)}
            >
              {t('shipment_bulk.transition_btn')}
            </Button>
          )}
          {canHardDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={bulkDeleting}
              onClick={handleBulkDelete}
            >
              {t('shipment_bulk.delete_btn')}
            </Button>
          )}
          <Button
            size="small"
            onClick={() => setSelectedRowKeys([])}
            style={{ marginLeft: 'auto' }}
          >
            {t('shipment_bulk.clear')}
          </Button>
        </Flex>
      )}

      <ProTable<IShipmentListItem>
        rowKey="id"
        dataSource={data?.results ?? []}
        loading={isLoading}
        columns={columns}
        search={false}
        options={{ reload: false, density: false, fullScreen: false, setting: { draggable: true, checkable: true } }}
        columnsState={{
          persistenceKey: COLUMN_STATE_KEY,
          persistenceType: 'localStorage',
          defaultValue: DEFAULT_COLUMN_STATE,
        }}
        rowSelection={(canEditAnyField && !isArchiveView) || canHardDelete ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
          preserveSelectedRowKeys: true,
        } : undefined}
        pagination={{
          current: page,
          pageSize,
          total: data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100'],
          showTotal: (total) => t('shipments.total', { count: total }),
          onChange: (p, ps) => {
            // Reset to page 1 only when page size changes; a plain page click
            // must keep `p` (setPageSize always clears page, so don't call it here).
            if (ps !== pageSize) setPageSize(ps);
            else setPage(p);
          },
        }}
        onRow={(record) => ({
          onClick: () => navigate(`/shipments/${record.id}`),
          style: { cursor: 'pointer' },
        })}
        rowHoverable
        size="middle"
        scroll={{ x: 900 }}
        dateFormatter={false}
        // Empty left toolbar — keeps the row minimal so only the column-settings
        // gear (rendered from `options`) shows on the right.
        toolBarRender={() => []}
      />

      <ShipmentCreateModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />

      <ShipmentEditDrawerForId
        shipmentId={editShipmentId}
        onClose={() => setEditShipmentId(null)}
      />

      <ShipmentBulkTransitionModal
        open={bulkTransitionOpen}
        onClose={() => setBulkTransitionOpen(false)}
        shipmentIds={selectedRowKeys}
        onFinished={() => setSelectedRowKeys([])}
      />

      <ShipmentFilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        initial={{
          country: countryFilter,
          customer: customerFilter,
          export_firm: exportFirmFilter,
          date_after: dateAfter,
          date_before: dateBefore,
          pending_my_fields: pendingMyFields,
        }}
        onApply={applyAdvancedFilters}
        onClear={clearAdvancedFilters}
      />
    </div>
  );
}
