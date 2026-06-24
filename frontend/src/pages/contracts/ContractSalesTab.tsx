import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Empty, Popconfirm, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useContractSales, useDeleteContractSale } from '@/hooks/useContractSales';
import { InvoiceDocumentsButton } from '@/components/InvoiceDocumentsButton';
import { ContractSaleCreate } from './ContractSaleCreate';
import type { IContractSale, ContractSaleStatus } from '@/types/contractSale';
import type { ICurrentUser } from '@/types';

const { Text } = Typography;

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

const STATUS_COLORS: Record<ContractSaleStatus, string> = {
  draft: 'default',
  sent: 'blue',
  paid: 'green',
  void: 'red',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface IContractSalesTabProps {
  contractId: number;
  /** Current user — used to gate the delete button */
  currentUser: ICurrentUser | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ContractSalesTab({
  contractId,
  currentUser,
}: IContractSalesTabProps) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<IContractSale | null>(null);

  // pageSize=200 (the project max) — covers any single contract's sale count
  // (planned_trucks rarely exceeds 72). Pagination UI not needed inside the tab.
  const { data, isLoading } = useContractSales({ contractId, pageSize: 200 });
  const deleteMutation = useDeleteContractSale();

  const sales = data?.results ?? [];
  const isAdmin =
    currentUser?.is_superuser || currentUser?.role === 'admin';

  // Derive the next invoice number from the max of existing sales.
  // last_invoice_number is a model field but is NOT exposed by ContractListSerializer,
  // so we compute it from the sales already loaded for this tab.
  const nextInvoiceNumber =
    sales.length > 0
      ? Math.max(...sales.map((s) => s.invoice_number)) + 1
      : 1;

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success(t('sales.delete.toast'));
    } catch {
      toast.error(t('common.error'));
    }
  };

  const handleEditClose = () => {
    setEditingSale(null);
  };

  // ─── Column definitions ─────────────────────────────────────────────────

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
    },
    {
      title: t('sales.column.invoice_date'),
      dataIndex: 'invoice_date',
      width: 100,
      render: (_, record) =>
        record.invoice_date
          ? dayjs(record.invoice_date).format('DD.MM.YYYY')
          : '—',
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
      title: t('sales.column.shipment_code'),
      dataIndex: 'shipment_code',
      width: 130,
      render: (_, record) => {
        if (record.shipment && record.shipment_code) {
          return (
            <Link to={`/shipments/${record.shipment}`}>
              {record.shipment_code}
            </Link>
          );
        }
        return <Text type="secondary">—</Text>;
      },
    },
    {
      title: t('sales.column.quantity_kg'),
      dataIndex: 'quantity_kg',
      width: 110,
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
      render: (_, record) =>
        record.total_usd ? `$${fmt(record.total_usd)}` : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('sales.column.passport_sdelka'),
      dataIndex: 'passport_sdelka',
      width: 130,
      ellipsis: true,
      render: (_, record) =>
        record.passport_sdelka || <Text type="secondary">—</Text>,
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
        <span style={{ display: 'flex', gap: 4 }}>
          {/* Documents (Invoice / CMR, RU/EN, docx/pdf) */}
          <InvoiceDocumentsButton invoiceId={record.id} />
          {/* Edit */}
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => setEditingSale(record)}
          />
          {/* Delete — admin/superuser only */}
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
          {t('sales.empty.title')}
          <br />
          <Button
            type="link"
            style={{ padding: 0, marginTop: 4 }}
            onClick={() => setCreateOpen(true)}
          >
            {t('sales.empty.cta')}
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
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
        bordered
        locale={{ emptyText: emptyState }}
        toolBarRender={() => [
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            {t('sales.add_button')}
          </Button>,
        ]}
      />

      {/* Create modal */}
      <ContractSaleCreate
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        contractId={contractId}
        nextInvoiceNumber={nextInvoiceNumber}
      />

      {/* Edit modal — key forces remount when switching between different sales */}
      {editingSale && (
        <ContractSaleCreate
          key={editingSale.id}
          open={editingSale !== null}
          onClose={handleEditClose}
          contractId={contractId}
          nextInvoiceNumber={nextInvoiceNumber}
          editingSale={editingSale}
        />
      )}
    </>
  );
}
