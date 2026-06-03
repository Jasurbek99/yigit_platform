import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Select,
  Switch,
  Tag,
  Typography,
  Input,
  Space,
} from 'antd';
import { PlusOutlined, FileTextOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { useContracts } from '@/hooks/useContracts';
import { ContractCreate } from './ContractCreate';
import type { IContract, ContractStatus } from '@/types/contract';
import { COLORS } from '@/constants/styles';

const { Text, Title } = Typography;
const { Search } = Input;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  return Math.round(num).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Returns '—' only for zero values on Exported columns. */
function fmtExported(value: string | number | null | undefined): React.ReactNode {
  if (value === null || value === undefined) return <Text type="secondary">—</Text>;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return <Text type="secondary">—</Text>;
  return Math.round(num).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

const STATUS_COLORS: Record<ContractStatus, string> = {
  active: 'blue',
  completed: 'green',
  closed: 'default',
  cancelled: 'red',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContractList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-synced "show ended" toggle
  const showEnded = searchParams.get('ended') === '1';
  const handleShowEndedToggle = (checked: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (checked) {
      next.set('ended', '1');
    } else {
      next.delete('ended');
    }
    setSearchParams(next, { replace: true });
  };

  // Status filter (toolbar only, client-side)
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all');

  // Client-side search on contract_number
  const [searchText, setSearchText] = useState('');

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError } = useContracts({ includeEnded: showEnded });
  const allRows = data?.results ?? [];

  // Apply client-side search + status filter
  const rows = allRows.filter((row) => {
    const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
    const matchesSearch =
      !searchText ||
      row.contract_number.toLowerCase().includes(searchText.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // ─── Column definitions ───────────────────────────────────────────────────

  const columns: ProColumns<IContract>[] = [
    {
      title: '#',
      dataIndex: 'index',
      width: 50,
      search: false,
      render: (_, __, index) => index + 1,
    },
    {
      title: t('contracts.column.contract_number'),
      dataIndex: 'contract_number',
      width: 160,
      ellipsis: true,
    },
    {
      title: t('contracts.column.seller'),
      dataIndex: 'export_firm_name',
      width: 160,
      ellipsis: true,
      render: (_, record) =>
        record.export_firm_name ? (
          record.export_firm_name
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('contracts.column.buyer'),
      dataIndex: 'import_firm_name',
      width: 160,
      ellipsis: true,
      render: (_, record) =>
        record.import_firm_name ? (
          record.import_firm_name
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('contracts.column.incoterm'),
      dataIndex: 'incoterm',
      width: 80,
    },

    // ── Planlanan group ──────────────────────────────────────────────────────
    {
      title: t('contracts.group.planned'),
      children: [
        {
          title: t('contracts.column.planned_trucks'),
          dataIndex: 'planned_trucks',
          width: 80,
          responsive: ['md'],
          render: (_, record) => fmt(record.planned_trucks),
        },
        {
          title: t('contracts.column.planned_quantity_kg'),
          dataIndex: 'planned_quantity_kg',
          width: 110,
          responsive: ['md'],
          render: (_, record) => fmt(record.planned_quantity_kg),
        },
        {
          title: t('contracts.column.planned_amount_usd'),
          dataIndex: 'planned_amount_usd',
          width: 110,
          responsive: ['md'],
          render: (_, record) => fmt(record.planned_amount_usd),
        },
      ],
    },

    // ── Eksport edilen group ─────────────────────────────────────────────────
    {
      title: t('contracts.group.exported'),
      children: [
        {
          title: t('contracts.column.exported_trucks'),
          dataIndex: 'exported_trucks',
          width: 80,
          render: (_, record) => fmtExported(record.exported_trucks),
        },
        {
          title: t('contracts.column.exported_quantity_kg'),
          dataIndex: 'exported_quantity_kg',
          width: 110,
          responsive: ['md'],
          render: (_, record) => fmtExported(record.exported_quantity_kg),
        },
        {
          title: t('contracts.column.exported_amount_usd'),
          dataIndex: 'exported_amount_usd',
          width: 110,
          responsive: ['md'],
          render: (_, record) => fmtExported(record.exported_amount_usd),
        },
      ],
    },

    // ── Galan group ──────────────────────────────────────────────────────────
    {
      title: t('contracts.group.remaining'),
      children: [
        {
          title: t('contracts.column.trucks_remaining'),
          dataIndex: 'trucks_remaining',
          width: 80,
          render: (_, record) => fmt(record.trucks_remaining),
        },
        {
          title: t('contracts.column.quantity_remaining_kg'),
          dataIndex: 'quantity_remaining_kg',
          width: 110,
          responsive: ['md'],
          render: (_, record) => fmt(record.quantity_remaining_kg),
        },
      ],
    },

    // ── Tölegler group ───────────────────────────────────────────────────────
    {
      title: t('contracts.group.payments'),
      children: [
        {
          title: t('contracts.column.payment_received_usd'),
          dataIndex: 'payment_received_usd',
          width: 110,
          responsive: ['md'],
          render: (_, record) => fmt(record.payment_received_usd),
        },
        {
          title: t('contracts.column.ostatok_usd'),
          dataIndex: 'ostatok_usd',
          width: 110,
          responsive: ['md'],
          render: (_, record) => fmt(record.ostatok_usd),
        },
      ],
    },

    // ── Status ───────────────────────────────────────────────────────────────
    {
      title: t('contracts.column.status'),
      dataIndex: 'status',
      width: 110,
      render: (_, record) => (
        <Tag color={STATUS_COLORS[record.status] ?? 'default'}>
          {t(`contracts.status.${record.status}`)}
        </Tag>
      ),
    },
  ];

  if (isError) {
    return (
      <Alert
        message={t('common.load_error')}
        type="error"
        style={{ marginTop: 40 }}
      />
    );
  }

  const statusOptions: { value: ContractStatus | 'all'; label: string }[] = [
    { value: 'all', label: t('common.all') },
    { value: 'active', label: t('contracts.status.active') },
    { value: 'completed', label: t('contracts.status.completed') },
    { value: 'closed', label: t('contracts.status.closed') },
  ];

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileTextOutlined style={{ color: COLORS.primary }} />
          {t('contracts.page_title')}
        </Title>
      </div>

      <ProTable<IContract>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        size="small"
        scroll={{ x: 'max-content' }}
        bordered
        onRow={(record) => ({
          onClick: () => navigate(`/contracts/${record.id}`),
          style: { cursor: 'pointer' },
        })}
        rowHoverable
        toolBarRender={() => [
          /* Create button */
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            {t('contracts.create_button')}
          </Button>,

          /* Search */
          <Search
            key="search"
            allowClear
            placeholder={t('contracts.column.contract_number')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 200 }}
          />,

          /* Status filter */
          <Select
            key="status-filter"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            options={statusOptions}
            style={{ width: 130 }}
            size="middle"
          />,

          /* Show ended toggle */
          <Space key="show-ended" align="center">
            <Switch
              size="small"
              checked={showEnded}
              onChange={handleShowEndedToggle}
            />
            <Text style={{ fontSize: 13 }}>
              {t('contracts.show_ended_toggle')}
            </Text>
          </Space>,
        ]}
      />

      {/* Create modal */}
      <ContractCreate open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
