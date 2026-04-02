import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

const PHASE_OPTIONS = [
  { value: 'planlanyan', label: 'Planlanýar' },
  { value: 'yuklenme', label: 'Ýüklenýär' },
  { value: 'bardy', label: 'Ýolda' },
  { value: 'gumruk_girish', label: 'Serhetde' },
  { value: 'satylyor', label: 'Satylýar' },
  { value: 'satyldy', label: 'Satyldy' },
  { value: 'tamamlandy', label: 'Tamamlandy' },
];

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
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<string | undefined>(undefined);
  const [createModalOpen, setCreateModalOpen] = useState(false);

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
      title: 'Kod',
      dataIndex: 'cargo_code',
      width: 140,
      render: (_, record) => (
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: '#1677ff',
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
      render: (val) => (val as string) ?? '—',
    },
    {
      title: 'Ugur',
      dataIndex: 'country_name',
      width: 130,
      render: (val) => withFlag((val as string) ?? null),
    },
    {
      title: t('shipments.status'),
      dataIndex: 'status_display',
      width: 150,
      render: (_, record) => <StatusTag statusDisplay={record.status_display} />,
    },
    {
      title: 'Agram (kg)',
      dataIndex: 'weight_net',
      width: 120,
      align: 'right',
      responsive: ['md'],
      render: (val) =>
        val != null ? (
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            {Number(val).toLocaleString()}
          </span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
    {
      title: 'Ýola çykdy',
      dataIndex: 'departed_at',
      width: 130,
      render: (val) =>
        val ? (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#8c8c8c', fontSize: 12 }}>
            {dayjs(val as string).format('DD.MM.YY HH:mm')}
          </span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
    {
      title: 'Geldi',
      dataIndex: 'arrived_at',
      width: 130,
      responsive: ['md'],
      render: (val) =>
        val ? (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#8c8c8c', fontSize: 12 }}>
            {dayjs(val as string).format('DD.MM.YY HH:mm')}
          </span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
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
              ? `Jemi ${data.count.toLocaleString()} ýük — 2025/2026 eksport möwsümi`
              : '2025/2026 eksport möwsümi'}
          </Text>
        </div>
        {canCreate && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
          >
            {t('shipment_create.title')}
          </Button>
        )}
      </Flex>

      {/* Filter bar */}
      <Flex gap={8} wrap="wrap" align="center" style={{ marginBottom: 12 }}>
        <Input.Search
          placeholder="Kod, müşderi..."
          style={{ width: 220 }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          onSearch={(val) => { setSearch(val); setPage(1); }}
          allowClear
        />
        <Select
          style={{ width: 160 }}
          placeholder="Status: Hemmesi"
          value={phaseFilter}
          onChange={(val) => { setPhaseFilter(val ?? undefined); setPage(1); }}
          options={PHASE_OPTIONS}
          allowClear
        />
        <Segmented
          value={viewMode}
          options={[
            { label: t('shipments.all'), value: 'all' },
            { label: t('shipments.my_work'), value: 'my_work' },
          ]}
          onChange={(val) => { setViewMode(val as ViewMode); setPage(1); }}
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
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
