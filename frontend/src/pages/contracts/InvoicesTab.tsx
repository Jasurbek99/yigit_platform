import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Empty, Popconfirm, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useInvoices, useDeleteInvoice } from '@/hooks/useInvoices';
import { InvoiceCreate } from './InvoiceCreate';
import type { IInvoice, InvoiceStatus } from '@/types/invoice';
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

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'default',
  sent: 'blue',
  paid: 'green',
  void: 'red',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface IInvoicesTabProps {
  contractId: number;
  /** Current user — used to gate the delete button */
  currentUser: ICurrentUser | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoicesTab({
  contractId,
  currentUser,
}: IInvoicesTabProps) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<IInvoice | null>(null);

  // pageSize=200 (the project max) — covers any single contract's invoice count
  // (planned_trucks rarely exceeds 72). Pagination UI not needed inside the tab.
  const { data, isLoading } = useInvoices({ contractId, pageSize: 200 });
  const deleteMutation = useDeleteInvoice();

  const invoices = data?.results ?? [];
  const isAdmin =
    currentUser?.is_superuser || currentUser?.role === 'admin';

  // Derive the next invoice number from the max of existing invoices.
  // last_invoice_number is a model field but is NOT exposed by ContractListSerializer,
  // so we compute it from the invoices already loaded for this tab.
  const nextInvoiceNumber =
    invoices.length > 0
      ? Math.max(...invoices.map((inv) => inv.invoice_number)) + 1
      : 1;

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success(t('invoices.delete.toast'));
    } catch {
      toast.error(t('common.error'));
    }
  };

  const handleEditClose = () => {
    setEditingInvoice(null);
  };

  // ─── Column definitions ─────────────────────────────────────────────────

  const columns: ProColumns<IInvoice>[] = [
    {
      title: '#',
      dataIndex: 'index',
      width: 48,
      search: false,
      render: (_, __, index) => index + 1,
    },
    {
      title: t('invoices.column.invoice_number'),
      dataIndex: 'invoice_number',
      width: 80,
    },
    {
      title: t('invoices.column.invoice_date'),
      dataIndex: 'invoice_date',
      width: 100,
      render: (_, record) =>
        record.invoice_date
          ? dayjs(record.invoice_date).format('DD.MM.YYYY')
          : '—',
    },
    {
      title: t('invoices.column.serial_truck_number'),
      dataIndex: 'serial_truck_number',
      width: 80,
      render: (_, record) =>
        record.serial_truck_number != null ? record.serial_truck_number : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('invoices.column.shipment_code'),
      dataIndex: 'shipment_code',
      width: 130,
      render: (_, record) => {
        if (record.shipment && record.shipment_code) {
          return (
            <Link to={`/export/shipments/${record.shipment}`}>
              {record.shipment_code}
            </Link>
          );
        }
        return <Text type="secondary">—</Text>;
      },
    },
    {
      title: t('invoices.column.quantity_kg'),
      dataIndex: 'quantity_kg',
      width: 110,
      render: (_, record) => fmt(record.quantity_kg),
    },
    {
      title: t('invoices.column.price_per_kg'),
      dataIndex: 'price_per_kg',
      width: 90,
      render: (_, record) => fmtPrice(record.price_per_kg),
    },
    {
      title: t('invoices.column.total_usd'),
      dataIndex: 'total_usd',
      width: 110,
      render: (_, record) =>
        record.total_usd ? `$${fmt(record.total_usd)}` : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('invoices.column.passport_sdelka'),
      dataIndex: 'passport_sdelka',
      width: 130,
      ellipsis: true,
      render: (_, record) =>
        record.passport_sdelka || <Text type="secondary">—</Text>,
    },
    {
      title: t('invoices.column.scan_uploaded'),
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
      title: t('invoices.column.status'),
      dataIndex: 'status',
      width: 90,
      render: (_, record) => (
        <Tag color={STATUS_COLORS[record.status] ?? 'default'}>
          {t(`invoices.status.${record.status}`)}
        </Tag>
      ),
    },
    {
      title: t('invoices.column.action'),
      dataIndex: 'action',
      width: isAdmin ? 100 : 60,
      search: false,
      render: (_, record) => (
        <span style={{ display: 'flex', gap: 4 }}>
          {/* Edit */}
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => setEditingInvoice(record)}
          />
          {/* Delete — admin/superuser only */}
          {isAdmin && (
            <Popconfirm
              title={t('invoices.delete.confirm_title')}
              description={t('invoices.delete.confirm_body')}
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
          {t('invoices.empty.title')}
          <br />
          <Button
            type="link"
            style={{ padding: 0, marginTop: 4 }}
            onClick={() => setCreateOpen(true)}
          >
            {t('invoices.empty.cta')}
          </Button>
        </span>
      }
      style={{ padding: '32px 0' }}
    />
  );

  return (
    <>
      <ProTable<IInvoice>
        rowKey="id"
        dataSource={invoices}
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
            {t('invoices.add_button')}
          </Button>,
        ]}
      />

      {/* Create modal */}
      <InvoiceCreate
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        contractId={contractId}
        nextInvoiceNumber={nextInvoiceNumber}
      />

      {/* Edit modal — key forces remount when switching between different invoices */}
      {editingInvoice && (
        <InvoiceCreate
          key={editingInvoice.id}
          open={editingInvoice !== null}
          onClose={handleEditClose}
          contractId={contractId}
          nextInvoiceNumber={nextInvoiceNumber}
          editingInvoice={editingInvoice}
        />
      )}
    </>
  );
}
