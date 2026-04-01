import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Segmented, Button, Dropdown } from 'antd';
import { DownloadOutlined, PrinterOutlined, FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
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

type ViewMode = 'all' | 'my_work';

interface ISearchValues {
  cargo_code?: string;
}

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
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const canCreate = user?.role === 'export_manager' || user?.role === 'director';

  const { data, isLoading } = useShipments({
    page,
    page_size: pageSize,
    my_work: viewMode === 'my_work' || undefined,
    search: search || undefined,
  });

  const columns: ProColumns<IShipmentListItem>[] = [
    {
      title: t('shipments.cargo_code'),
      dataIndex: 'cargo_code',
      fixed: 'left',
      width: 130,
      render: (_dom, record) => <strong>{record.cargo_code}</strong>,
    },
    {
      title: t('shipments.date'),
      dataIndex: 'date',
      width: 100,
      render: (_dom, record) =>
        record.date ? dayjs(record.date).format('DD.MM.YYYY') : '—',
      responsive: ['md'],
    },
    {
      title: t('shipments.status'),
      dataIndex: 'status_display',
      width: 140,
      render: (_dom, record) => (
        <StatusTag statusDisplay={record.status_display} />
      ),
    },
    {
      title: t('shipments.country'),
      dataIndex: 'country_name',
      width: 120,
      render: (_dom, record) => record.country_name ?? '—',
      responsive: ['md'],
    },
    {
      title: t('shipments.customer'),
      dataIndex: 'customer_name',
      width: 150,
      render: (_dom, record) => record.customer_name ?? '—',
    },
    {
      title: t('shipments.weight_net'),
      dataIndex: 'weight_net',
      width: 100,
      align: 'right',
      render: (_dom, record) =>
        record.weight_net != null
          ? Number(record.weight_net).toLocaleString()
          : '—',
      responsive: ['md'],
    },
    {
      title: t('shipments.departed'),
      dataIndex: 'departed_at',
      width: 130,
      render: (_dom, record) =>
        record.departed_at
          ? dayjs(record.departed_at).format('DD.MM.YY HH:mm')
          : '—',
      responsive: ['lg'],
    },
    {
      title: t('shipments.arrived'),
      dataIndex: 'arrived_at',
      width: 130,
      render: (_dom, record) =>
        record.arrived_at
          ? dayjs(record.arrived_at).format('DD.MM.YY HH:mm')
          : '—',
      responsive: ['lg'],
    },
  ];

  function handleViewModeChange(val: string | number) {
    setViewMode(val as ViewMode);
    setPage(1);
  }

  function handleSearch(values: Record<string, unknown>) {
    const typed = values as ISearchValues;
    setSearch(typed.cargo_code ?? '');
    setPage(1);
  }

  function handleReset() {
    setSearch('');
    setPage(1);
  }

  function handlePageChange(nextPage: number, nextPageSize: number) {
    setPage(nextPage);
    setPageSize(nextPageSize);
  }

  function handlePrint() {
    window.print();
  }

  function handleCreateSuccess() {
    void queryClient.invalidateQueries({ queryKey: ['shipments'] });
  }

  const exportMenuItems = [
    {
      key: 'excel',
      icon: <FileExcelOutlined />,
      label: t('shipments.export_excel'),
      onClick: () => exportToExcel(data?.results ?? [], t),
    },
    {
      key: 'print',
      icon: <PrinterOutlined />,
      label: t('shipments.print'),
      onClick: handlePrint,
    },
  ];

  return (
    <div className="shipment-list-page">
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3' }}>
            {t('shipments.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            2025/2026 eksport möwsümi
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Segmented
            size="small"
            options={[
              { label: t('shipments.all'), value: 'all' },
              { label: t('shipments.my_work'), value: 'my_work' },
            ]}
            value={viewMode}
            onChange={handleViewModeChange}
          />
          <Dropdown menu={{ items: exportMenuItems }} placement="bottomRight">
            <Button size="small" icon={<DownloadOutlined />}>{t('shipments.export')}</Button>
          </Dropdown>
          {canCreate && (
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalOpen(true)}
            >
              {t('shipment_create.title')}
            </Button>
          )}
        </div>
      </div>

      <ProTable<IShipmentListItem>
        rowKey="id"
        dataSource={data?.results ?? []}
        columns={columns}
        loading={isLoading}
        search={{ filterType: 'light' }}
        onSubmit={handleSearch}
        onReset={handleReset}
        pagination={{
          current: page,
          pageSize,
          total: data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100'],
          onChange: handlePageChange,
          showTotal: (total) => t('shipments.total', { count: total }),
        }}
        scroll={{ x: 900 }}
        options={{ density: false, fullScreen: false }}
        toolbar={{ title: data ? t('shipments.total', { count: data.count }) : '' }}
        onRow={(record) => ({
          onClick: () => navigate(`/shipments/${record.id}`),
          style: { cursor: 'pointer' },
        })}
      />

      <ShipmentCreateModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
