import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Flex, Input, Select, Segmented, Typography } from 'antd';
import { PlusOutlined, DownloadOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { StatusTag } from '@/components/StatusTag';
import { ShipmentCreateModal } from '@/components/ShipmentCreateModal';
import { useShipments } from '@/hooks/useShipments';
import { useAuth } from '@/hooks/useAuth';
import { COLORS, FONT } from '@/constants/styles';
import type { IShipmentListItem } from '@/types';

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

  const viewMode: ViewMode = searchParams.get('view') === 'my_work' ? 'my_work' : 'all';
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('pageSize')) || 50;
  const search = searchParams.get('search') ?? '';
  const phaseFilter = searchParams.get('phase') ?? undefined;

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

  const canCreate = user?.role === 'export_manager' || user?.role === 'director';

  const { data, isLoading } = useShipments({
    page,
    page_size: pageSize,
    my_work: viewMode === 'my_work' || undefined,
    search: search || undefined,
    phase: phaseFilter,
  });

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
      render: (val) =>
        val != null ? (
          <span style={{ fontFamily: FONT.mono }}>
            {Number(val).toLocaleString()}
          </span>
        ) : (
          <span style={{ color: COLORS.textMuted }}>—</span>
        ),
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
          icon={<DownloadOutlined />}
          onClick={() => exportToExcel(data?.results ?? [], t)}
          style={{ marginLeft: 'auto' }}
        >
          Excel
        </Button>
      </Flex>

      <ProTable<IShipmentListItem>
        rowKey="id"
        dataSource={data?.results ?? []}
        loading={isLoading}
        columns={columns}
        search={false}
        options={false}
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
    </div>
  );
}
