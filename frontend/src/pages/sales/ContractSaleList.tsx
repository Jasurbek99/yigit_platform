import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, DatePicker, Empty, Popconfirm, Select, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useContractSales, useDeleteContractSale } from '@/hooks/useContractSales';
import { useAuth } from '@/hooks/useAuth';
import { ExportFirmSelect } from '@/components/ExportFirmSelect';
import { ImportFirmSelect } from '@/components/ImportFirmSelect';
import { InvoiceDocumentsButton } from '@/components/InvoiceDocumentsButton';
import { ContractSaleCreate } from '@/pages/contracts/ContractSaleCreate';
import type { IContractSale, ContractSaleStatus } from '@/types/contractSale';

const { Text, Link: TypoLink } = Typography;

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<ContractSaleStatus, string> = {
  draft: 'default',
  sent: 'blue',
  paid: 'green',
  void: 'red',
};

const CONTRACT_SALE_STATUSES: ContractSaleStatus[] = ['draft', 'sent', 'paid', 'void'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  return Math.round(num).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtPrice(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';
  return num.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContractSaleList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<IContractSale | null>(null);

  // Local state for the search input so we can debounce URL writes (which
  // trigger refetches). Without the debounce every keystroke refetches.
  const urlSearch = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(urlSearch);

  // Sync local → URL after a 300 ms idle.
  useEffect(() => {
    if (searchInput === urlSearch) return;
    const handle = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (searchInput) next.set('q', searchInput); else next.delete('q');
        next.delete('page'); // reset to page 1 on new search
        return next;
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput, urlSearch, setSearchParams]);

  const { user: auth } = useAuth();
  const isAdmin = auth?.is_superuser || auth?.role === 'admin';

  // ─── URL-synced filter state ─────────────────────────────────────────────

  const statusFilter = (searchParams.get('status') as ContractSaleStatus | null) ?? undefined;
  const searchText = searchParams.get('q') ?? '';
  const exportFirmFilter = searchParams.get('export_firm')
    ? Number(searchParams.get('export_firm'))
    : undefined;
  const importFirmFilter = searchParams.get('import_firm')
    ? Number(searchParams.get('import_firm'))
    : undefined;
  const dateFrom = searchParams.get('date_from') ?? undefined;
  const dateTo = searchParams.get('date_to') ?? undefined;

  const setStatus = (v: ContractSaleStatus | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set('status', v); else next.delete('status');
      return next;
    });
  };

  const setExportFirm = (v: number | null | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v != null) next.set('export_firm', String(v)); else next.delete('export_firm');
      return next;
    });
  };

  const setImportFirm = (v: number | null | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v != null) next.set('import_firm', String(v)); else next.delete('import_firm');
      return next;
    });
  };

  const setDateRange = (from: string | undefined, to: string | undefined) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (from) next.set('date_from', from); else next.delete('date_from');
      if (to) next.set('date_to', to); else next.delete('date_to');
      return next;
    });
  };

  // ─── Pagination state ────────────────────────────────────────────────────

  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('page_size')) || 50;

  const setPage = (p: number, ps: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(p));
      next.set('page_size', String(ps));
      return next;
    });
  };

  // ─── Data fetch (server-side filtering + pagination) ─────────────────────

  const { data, isLoading } = useContractSales({
    status: statusFilter,
    exportFirm: exportFirmFilter,
    importFirm: importFirmFilter,
    dateFrom,
    dateTo,
    search: searchText || undefined,
    page,
    pageSize,
  });

  const sales = data?.results ?? [];
  const total = data?.count ?? 0;

  const deleteMutation = useDeleteContractSale();

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success(t('sales.delete.toast'));
    } catch {
      toast.error(t('common.error'));
    }
  };

  // ─── Column definitions ──────────────────────────────────────────────────

  const columns: ProColumns<IContractSale>[] = [
    {
      title: '#',
      dataIndex: 'index',
      width: 48,
      search: false,
      render: (_, __, index) => index + 1,
    },
    {
      title: t('sales.column.invoice_number'),
      dataIndex: 'invoice_number',
      width: 80,
      sorter: (a, b) => a.invoice_number - b.invoice_number,
    },
    {
      title: t('sales.column.invoice_date'),
      dataIndex: 'invoice_date',
      width: 110,
      defaultSortOrder: 'descend',
      sorter: (a, b) => {
        if (!a.invoice_date && !b.invoice_date) return 0;
        if (!a.invoice_date) return 1;
        if (!b.invoice_date) return -1;
        return a.invoice_date.localeCompare(b.invoice_date);
      },
      render: (_, record) =>
        record.invoice_date
          ? dayjs(record.invoice_date).format('DD.MM.YYYY')
          : '—',
    },
    {
      title: t('sales_list.column.contract_number'),
      dataIndex: 'contract_number',
      width: 150,
      sorter: (a, b) =>
        (a.contract_number || '').localeCompare(b.contract_number || ''),
      render: (_, record) =>
        record.contract ? (
          <TypoLink
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/contracts/${record.contract}`);
            }}
          >
            {record.contract_number}
          </TypoLink>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('sales_list.column.export_firm'),
      dataIndex: 'export_firm_name',
      width: 150,
      sorter: (a, b) =>
        (a.export_firm_name || '').localeCompare(b.export_firm_name || ''),
      render: (_, record) =>
        record.export_firm_name ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('sales_list.column.import_firm'),
      dataIndex: 'import_firm_name',
      width: 150,
      sorter: (a, b) =>
        (a.import_firm_name || '').localeCompare(b.import_firm_name || ''),
      render: (_, record) =>
        record.import_firm_name ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('sales.column.serial_truck_number'),
      dataIndex: 'serial_truck_number',
      width: 80,
      render: (_, record) =>
        record.serial_truck_number != null ? record.serial_truck_number : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('sales.column.quantity_kg'),
      dataIndex: 'quantity_kg',
      width: 110,
      sorter: (a, b) =>
        (a.quantity_kg != null ? parseFloat(a.quantity_kg) : 0) -
        (b.quantity_kg != null ? parseFloat(b.quantity_kg) : 0),
      render: (_, record) => fmt(record.quantity_kg),
    },
    {
      title: t('sales.column.price_per_kg'),
      dataIndex: 'price_per_kg',
      width: 90,
      render: (_, record) => fmtPrice(record.price_per_kg),
    },
    {
      title: t('sales.column.total_usd'),
      dataIndex: 'total_usd',
      width: 110,
      sorter: (a, b) =>
        (a.total_usd != null ? parseFloat(a.total_usd) : 0) -
        (b.total_usd != null ? parseFloat(b.total_usd) : 0),
      render: (_, record) =>
        record.total_usd ? `$${fmt(record.total_usd)}` : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('sales.column.passport_sdelka'),
      dataIndex: 'passport_sdelka',
      width: 160,
      render: (_, record) => {
        if (!record.passport_sdelka) return <Text type="secondary">—</Text>;
        const text = record.passport_sdelka;
        const truncated = text.length > 24 ? `${text.slice(0, 24)}…` : text;
        return text.length > 24 ? (
          <Tooltip title={text}>
            <span>{truncated}</span>
          </Tooltip>
        ) : text;
      },
    },
    {
      title: t('sales.column.scan_uploaded'),
      dataIndex: 'scan_uploaded',
      width: 70,
      render: (_, record) =>
        record.scan_uploaded ? (
          <Text style={{ color: '#52c41a' }}>✓</Text>
        ) : (
          <Text type="secondary">✗</Text>
        ),
    },
    {
      title: t('sales.column.status'),
      dataIndex: 'status',
      width: 90,
      render: (_, record) => (
        <Tag color={STATUS_COLORS[record.status] ?? 'default'}>
          {t(`sales.status.${record.status}`)}
        </Tag>
      ),
    },
    {
      title: t('sales.column.action'),
      dataIndex: 'action',
      width: isAdmin ? 130 : 96,
      search: false,
      render: (_, record) => (
        <span
          style={{ display: 'flex', gap: 4 }}
          onClick={(e) => e.stopPropagation()}
        >
          <InvoiceDocumentsButton invoiceId={record.id} />
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              setEditingSale(record);
            }}
          />
          {isAdmin && (
            <Popconfirm
              title={t('sales.delete.confirm_title')}
              description={t('sales.delete.confirm_body')}
              okText={t('common.delete')}
              cancelText={t('common.cancel')}
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record.id)}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={deleteMutation.isPending}
              />
            </Popconfirm>
          )}
        </span>
      ),
    },
  ];

  const emptyState = (
    <Empty
      description={
        <span>
          {t('sales_list.empty.title')}
          <br />
          <Button
            type="link"
            style={{ padding: 0, marginTop: 4 }}
            onClick={() => setCreateOpen(true)}
          >
            {t('sales_list.empty.cta')}
          </Button>
        </span>
      }
      style={{ padding: '32px 0' }}
    />
  );

  return (
    <>
      <ProTable<IContractSale>
        rowKey="id"
        dataSource={sales}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{
          current: page,
          pageSize,
          total,
          pageSizeOptions: ['25', '50', '100', '200'],
          showSizeChanger: true,
          showTotal: (n) => t('sales_list.pagination.total', { total: n }),
          onChange: (p, ps) => setPage(p, ps),
        }}
        size="small"
        scroll={{ x: 'max-content' }}
        bordered
        locale={{ emptyText: emptyState }}
        onRow={(record) => ({
          onClick: () => {
            if (record.contract) {
              navigate(`/contracts/${record.contract}`);
            }
          },
          style: { cursor: record.contract ? 'pointer' : 'default' },
        })}
        toolBarRender={() => [
          /* Search box */
          <input
            key="search"
            type="text"
            value={searchInput}
            placeholder={t('sales_list.toolbar.search_placeholder')}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              padding: '4px 8px',
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              fontSize: 14,
              width: 200,
              outline: 'none',
            }}
          />,

          /* Export firm filter */
          <ExportFirmSelect
            key="export_firm"
            allowClear
            placeholder={t('sales_list.toolbar.export_firm_placeholder')}
            style={{ width: 160 }}
            value={exportFirmFilter ?? null}
            onChange={(v) => setExportFirm(v)}
          />,

          /* Import firm filter */
          <ImportFirmSelect
            key="import_firm"
            allowClear
            placeholder={t('sales_list.toolbar.import_firm_placeholder')}
            style={{ width: 160 }}
            value={importFirmFilter ?? null}
            onChange={(v) => setImportFirm(v)}
          />,

          /* Date range filter */
          <DatePicker.RangePicker
            key="date_range"
            allowClear
            style={{ width: 240 }}
            placeholder={
              t('sales_list.toolbar.date_range_placeholder', { returnObjects: true }) as [string, string]
            }
            value={
              dateFrom || dateTo
                ? [
                    dateFrom ? dayjs(dateFrom) : null,
                    dateTo ? dayjs(dateTo) : null,
                  ]
                : null
            }
            onChange={(dates) => {
              const from = dates?.[0]?.format('YYYY-MM-DD');
              const to = dates?.[1]?.format('YYYY-MM-DD');
              setDateRange(from, to);
            }}
          />,

          /* Status filter */
          <Select
            key="status"
            allowClear
            placeholder={t('sales_list.toolbar.status_placeholder')}
            style={{ width: 140 }}
            value={statusFilter}
            onChange={(v) => setStatus(v as ContractSaleStatus | undefined)}
            options={CONTRACT_SALE_STATUSES.map((s) => ({
              value: s,
              label: t(`sales.status.${s}`),
            }))}
          />,

          /* Add button */
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            {t('sales.add_button')}
          </Button>,
        ]}
        headerTitle={t('nav.sales.list')}
      />

      {/* Create modal — standalone mode (no contractId) */}
      <ContractSaleCreate
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      {/* Edit modal */}
      {editingSale && (
        <ContractSaleCreate
          key={editingSale.id}
          open={editingSale !== null}
          onClose={() => setEditingSale(null)}
          editingSale={editingSale}
        />
      )}
    </>
  );
}
