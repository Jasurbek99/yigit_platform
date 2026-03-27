import { useState } from 'react';
import { Typography, Segmented } from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import dayjs from 'dayjs';
import { StatusTag } from '@/components/StatusTag';
import { useShipments } from '@/hooks/useShipments';
import type { IShipmentListItem } from '@/types';

type ViewMode = 'all' | 'my_work';

interface ISearchValues {
  cargo_code?: string;
}

export default function ShipmentList() {
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useShipments({
    page,
    page_size: pageSize,
    my_work: viewMode === 'my_work' || undefined,
    search: search || undefined,
  });

  const columns: ProColumns<IShipmentListItem>[] = [
    {
      title: 'Cargo Code',
      dataIndex: 'cargo_code',
      fixed: 'left',
      width: 130,
      render: (_dom, record) => <strong>{record.cargo_code}</strong>,
    },
    {
      title: 'Date',
      dataIndex: 'date',
      width: 100,
      render: (_dom, record) =>
        record.date ? dayjs(record.date).format('DD.MM.YYYY') : '—',
      responsive: ['md'],
    },
    {
      title: 'Status',
      dataIndex: 'status_display',
      width: 140,
      render: (_dom, record) => (
        <StatusTag statusDisplay={record.status_display} />
      ),
    },
    {
      title: 'Country',
      dataIndex: 'country_name',
      width: 120,
      render: (_dom, record) => record.country_name ?? '—',
      responsive: ['md'],
    },
    {
      title: 'Customer',
      dataIndex: 'customer_name',
      width: 150,
      render: (_dom, record) => record.customer_name ?? '—',
    },
    {
      title: 'Net (kg)',
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
      title: 'Departed',
      dataIndex: 'departed_at',
      width: 130,
      render: (_dom, record) =>
        record.departed_at
          ? dayjs(record.departed_at).format('DD.MM.YY HH:mm')
          : '—',
      responsive: ['lg'],
    },
    {
      title: 'Arrived',
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

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          Shipments
        </Typography.Title>
        <Segmented
          options={[
            { label: 'All', value: 'all' },
            { label: 'My Work', value: 'my_work' },
          ]}
          value={viewMode}
          onChange={handleViewModeChange}
        />
      </div>

      <ProTable<IShipmentListItem>
        rowKey="id"
        dataSource={data?.results ?? []}
        columns={columns}
        loading={isLoading}
        search={{
          filterType: 'light',
        }}
        onSubmit={handleSearch}
        onReset={handleReset}
        pagination={{
          current: page,
          pageSize,
          total: data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100'],
          onChange: handlePageChange,
          showTotal: (total) => `${total} shipments`,
        }}
        scroll={{ x: 900 }}
        options={{ density: false, fullScreen: false }}
        toolbar={{
          title: data ? `${data.count} shipments` : '',
        }}
        onRow={(record) => ({
          onClick: () => {
            // eslint-disable-next-line no-console
            console.log('shipment id:', record.id);
          },
          style: { cursor: 'pointer' },
        })}
      />
    </div>
  );
}
