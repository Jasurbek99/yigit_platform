import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Flex, Input, Select, Segmented, Tag, Tooltip, Typography } from 'antd';
import { PlusOutlined, DownloadOutlined, EditOutlined, FilterOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
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

type ViewMode = 'all' | 'my_work';

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

const PHASE_KEYS = [
  'planlanyan', 'yuklenme', 'bardy', 'gumruk_girish', 'satylyor', 'satyldy', 'tamamlandy',
] as const;

function exportToExcel(rows: IShipmentListItem[], t: (k: string) => string) {
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

  const viewMode: ViewMode = searchParams.get('view') === 'my_work' ? 'my_work' : 'all';
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

  const { data, isLoading } = useShipments({
    page,
    page_size: pageSize,
    my_work: viewMode === 'my_work' || undefined,
    search: search || undefined,
    phase: phaseFilter,
    country: countryFilter,
    customer: customerFilter,
    export_firm: exportFirmFilter,
    date_after: dateAfter,
    date_before: dateBefore,
    pending_my_fields: pendingMyFields || undefined,
  });

  const advancedFilterCount = [
    countryFilter,
    customerFilter,
    exportFirmFilter,
    dateAfter,
    dateBefore,
    pendingMyFields ? 'on' : undefined,
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
      page: undefined,
    });
  }

  function handleCreateSuccess() {
    void queryClient.invalidateQueries({ queryKey: ['shipments'] });
  }

  const columns: ProColumns<IShipmentListItem>[] = [
    {
      title: t('shipments.cargo_code'),
      dataIndex: 'cargo_code',
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
      width: 150,
      render: (_, record) => record.customer_name ?? '—',
    },
    {
      title: t('shipments.country'),
      dataIndex: 'country_name',
      width: 130,
      render: (_, record) => withFlag(record.country_name ?? null),
    },
    {
      title: t('shipments.status'),
      dataIndex: 'status_display',
      width: 150,
      render: (_, record) => <StatusTag statusDisplay={record.status_display} />,
    },
    {
      title: t('shipments.weight_net'),
      dataIndex: 'weight_net',
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
            isEditable={canEditWeightNet}
            display={display}
          />
        );
      },
    },
    {
      title: t('shipments.departed'),
      dataIndex: 'departed_at',
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
    {
      title: '',
      key: '_actions',
      width: 56,
      align: 'center',
      fixed: 'right',
      render: (_, record) => {
        if (!canEditAnyField) return null;
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
        <Segmented
          value={viewMode}
          options={[
            { label: t('shipments.all'), value: 'all' },
            { label: t('shipments.my_work'), value: 'my_work' },
          ]}
          onChange={(val) => { setViewMode(val === 'my_work' ? 'my_work' : 'all'); setPage(1); }}
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
          onClick={() => exportToExcel(data?.results ?? [], t)}
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
        options={false}
        rowSelection={canEditAnyField ? {
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
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        onRow={(record) => ({
          onClick: () => navigate(`/shipments/${record.id}`),
          style: { cursor: 'pointer' },
        })}
        rowHoverable
        size="middle"
        scroll={{ x: 900 }}
        dateFormatter={false}
        toolBarRender={false}
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
