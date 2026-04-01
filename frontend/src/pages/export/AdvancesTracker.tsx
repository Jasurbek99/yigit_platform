import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Row,
  Col,
  Statistic,
  Card,
  Tag,
  Alert,
  Segmented,
  Typography,
  Button,
  Table,
  Empty,
  Modal,
  Form,
  Input,
  InputNumber,
  DatePicker,
  message,
} from 'antd';
import { DollarOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  useAdvances,
  useAdvanceDetail,
  useReconcileAdvance,
  useCreateAdvance,
} from '@/hooks/useAdvances';
import type { ICreateAdvancePayload } from '@/hooks/useAdvances';
import type {
  IFinansistAdvanceListItem,
  IAdvanceShipmentLink,
} from '@/types';
import { useAuth } from '@/hooks/useAuth';

// ─── Constants ────────────────────────────────────────────────────────────────

type ReconcileFilter = 'all' | 'pending' | 'reconciled';

const CAN_CREATE_ROLES = new Set(['finansist', 'export_manager', 'director']);

// ─── Linked Shipments Sub-table ───────────────────────────────────────────────

interface LinkedShipmentsProps {
  advanceId: number;
  noShipmentsLabel: string;
  cargoCodeLabel: string;
  allocatedAmountLabel: string;
}

function LinkedShipmentsPanel({
  advanceId,
  noShipmentsLabel,
  cargoCodeLabel,
  allocatedAmountLabel,
}: LinkedShipmentsProps) {
  const { data, isLoading } = useAdvanceDetail(advanceId);

  const links: IAdvanceShipmentLink[] = data?.shipment_links ?? [];

  if (!isLoading && links.length === 0) {
    return <Empty description={noShipmentsLabel} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const cols = [
    {
      title: cargoCodeLabel,
      dataIndex: 'shipment_cargo_code',
      key: 'cargo_code',
    },
    {
      title: allocatedAmountLabel,
      dataIndex: 'allocated_amount',
      key: 'allocated_amount',
      align: 'right' as const,
      render: (val: number | null) =>
        val != null ? `$${val.toLocaleString()}` : '—',
    },
  ];

  return (
    <Table<IAdvanceShipmentLink>
      rowKey="shipment"
      columns={cols}
      dataSource={links}
      loading={isLoading}
      pagination={false}
      size="small"
      style={{ maxWidth: 480 }}
    />
  );
}

// ─── New Advance Modal ────────────────────────────────────────────────────────

interface NewAdvanceModalProps {
  open: boolean;
  onClose: () => void;
}

function NewAdvanceModal({ open, onClose }: NewAdvanceModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ICreateAdvancePayload>();
  const createAdvance = useCreateAdvance();

  async function handleSubmit() {
    const values = await form.validateFields();
    const payload: ICreateAdvancePayload = {
      ...values,
      advance_date: dayjs(values.advance_date as unknown as dayjs.Dayjs).format('YYYY-MM-DD'),
    };
    createAdvance.mutate(payload, {
      onSuccess: () => {
        message.success(t('advances.create_success'));
        form.resetFields();
        onClose();
      },
      onError: () => {
        message.error(t('advances.error_load'));
      },
    });
  }

  function handleCancel() {
    form.resetFields();
    onClose();
  }

  return (
    <Modal
      title={t('advances.new_advance')}
      open={open}
      onOk={handleSubmit}
      onCancel={handleCancel}
      okText={t('advances.new_advance')}
      cancelText={t('common.cancel')}
      confirmLoading={createAdvance.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="batch_code" label={t('advances.batch_code')}>
          <Input placeholder="ADV-2026-XXX" />
        </Form.Item>
        <Form.Item
          name="advance_date"
          label={t('advances.date')}
          rules={[{ required: true }]}
        >
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="total_amount"
          label={t('advances.amount')}
          rules={[{ required: true }]}
        >
          <InputNumber
            min={0}
            precision={2}
            prefix="$"
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item
          name="currency"
          label={t('advances.currency')}
          initialValue="USD"
          rules={[{ required: true }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="purpose" label={t('advances.purpose')}>
          <Input />
        </Form.Item>
        <Form.Item name="notes" label={t('advances.notes')}>
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdvancesTracker() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<ReconcileFilter>('all');
  const [newAdvanceOpen, setNewAdvanceOpen] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<readonly number[]>([]);

  const reconcileFilter =
    filter === 'all' ? undefined : filter === 'reconciled' ? true : false;

  // ── Server data ────────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useAdvances({ reconciled: reconcileFilter });
  const reconcileAdvance = useReconcileAdvance();

  // ── Derived ────────────────────────────────────────────────────────────────
  const advances = data?.results ?? [];

  const { totalCount, totalAmount, unreconciledCount, unreconciledAmount } =
    useMemo(() => {
      // Always derive from the unfiltered list for summary cards
      const all = data?.results ?? [];
      const unreconciled = all.filter((a) => !a.reconciled);
      return {
        totalCount: data?.count ?? 0,
        totalAmount: all.reduce((sum, a) => sum + a.total_amount, 0),
        unreconciledCount: unreconciled.length,
        unreconciledAmount: unreconciled.reduce(
          (sum, a) => sum + a.total_amount,
          0,
        ),
      };
    }, [data]);

  const canCreate = user ? CAN_CREATE_ROLES.has(user.role) : false;

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleReconcile(id: number) {
    reconcileAdvance.mutate(id, {
      onSuccess: () => message.success(t('advances.reconciled')),
      onError: () => message.error(t('advances.error_load')),
    });
  }

  function handleFilterChange(value: string | number) {
    setFilter(value as ReconcileFilter);
  }

  function handleExpandedRowsChange(keys: readonly React.Key[]) {
    setExpandedRowKeys(keys as readonly number[]);
  }

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns: ProColumns<IFinansistAdvanceListItem>[] = [
    {
      title: t('advances.batch_code'),
      dataIndex: 'batch_code',
      width: 150,
      render: (_, record) =>
        record.batch_code ? (
          <Typography.Text code>{record.batch_code}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: t('advances.date'),
      dataIndex: 'advance_date',
      width: 110,
      sorter: (a, b) =>
        new Date(a.advance_date).getTime() - new Date(b.advance_date).getTime(),
      render: (_, record) => dayjs(record.advance_date).format('DD.MM.YYYY'),
    },
    {
      title: t('advances.amount'),
      dataIndex: 'total_amount',
      width: 130,
      align: 'right',
      sorter: (a, b) => a.total_amount - b.total_amount,
      render: (_, record) => (
        <Typography.Text strong>
          ${record.total_amount.toLocaleString()}
        </Typography.Text>
      ),
    },
    {
      title: t('advances.currency'),
      dataIndex: 'currency',
      width: 90,
      responsive: ['md'],
      render: (_, record) => record.currency,
    },
    {
      title: t('advances.purpose'),
      dataIndex: 'purpose',
      ellipsis: true,
      responsive: ['md'],
      render: (_, record) =>
        record.purpose ?? (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: t('advances.shipments'),
      dataIndex: 'shipment_count',
      width: 100,
      align: 'center',
      render: (_, record) => (
        <Tag color={record.shipment_count > 0 ? 'blue' : 'default'}>
          {record.shipment_count}
        </Tag>
      ),
    },
    {
      title: t('advances.allocated'),
      dataIndex: 'allocated_total',
      width: 130,
      align: 'right',
      responsive: ['lg'],
      render: (_, record) => {
        const isOver = record.allocated_total > record.total_amount;
        return (
          <Typography.Text style={isOver ? { color: '#ff4d4f' } : undefined}>
            ${record.allocated_total.toLocaleString()}
          </Typography.Text>
        );
      },
    },
    {
      title: t('advances.status'),
      dataIndex: 'reconciled',
      width: 120,
      render: (_, record) =>
        record.reconciled ? (
          <Tag color="success">{t('advances.reconciled')}</Tag>
        ) : (
          <Tag color="orange">{t('advances.pending')}</Tag>
        ),
    },
    {
      title: t('advances.issued_by'),
      dataIndex: 'issued_by_name',
      width: 120,
      responsive: ['lg'],
      render: (_, record) => record.issued_by_name,
    },
    {
      title: t('advances.reconcile'),
      dataIndex: 'id',
      width: 100,
      align: 'center',
      render: (_, record) =>
        !record.reconciled && canCreate ? (
          <Button
            size="small"
            type="link"
            loading={
              reconcileAdvance.isPending &&
              reconcileAdvance.variables === record.id
            }
            onClick={(e) => {
              e.stopPropagation();
              handleReconcile(record.id);
            }}
          >
            {t('advances.reconcile')}
          </Button>
        ) : null,
    },
  ];

  // ── Early returns ──────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Alert
        type="error"
        message={t('advances.error_load')}
        style={{ margin: 24 }}
      />
    );
  }

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '0 4px' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarOutlined style={{ color: '#1677ff', fontSize: 18 }} />
            {t('advances.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Müşderileriň öňünden töleg yzarlaýjysy
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setNewAdvanceOpen(true)}
            >
              {t('advances.new_advance')}
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered>
            <Statistic
              title={t('advances.total_advances')}
              value={totalCount}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered>
            <Statistic
              title={t('advances.total_amount')}
              value={totalAmount}
              prefix="$"
              precision={0}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered>
            <Statistic
              title={t('advances.unreconciled')}
              value={unreconciledCount}
              valueStyle={
                unreconciledCount > 0 ? { color: '#fa8c16' } : undefined
              }
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered>
            <Statistic
              title={t('advances.unreconciled_amount')}
              value={unreconciledAmount}
              prefix="$"
              precision={0}
              valueStyle={
                unreconciledAmount > 0 ? { color: '#fa8c16' } : undefined
              }
            />
          </Card>
        </Col>
      </Row>

      {/* Filter */}
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={filter}
          options={[
            { label: t('advances.all'), value: 'all' },
            { label: t('advances.pending'), value: 'pending' },
            { label: t('advances.reconciled'), value: 'reconciled' },
          ]}
          onChange={handleFilterChange}
        />
      </div>

      {/* Table */}
      <ProTable<IFinansistAdvanceListItem>
        rowKey="id"
        columns={columns}
        dataSource={advances}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 700 }}
        locale={{ emptyText: t('advances.empty') }}
        cardBordered
        expandable={{
          expandedRowKeys: expandedRowKeys as React.Key[],
          onExpandedRowsChange: handleExpandedRowsChange,
          expandedRowRender: (record) => (
            <div style={{ padding: '8px 0 8px 16px' }}>
              <Typography.Text
                type="secondary"
                style={{ display: 'block', marginBottom: 8 }}
              >
                {t('advances.linked_shipments')}
              </Typography.Text>
              <LinkedShipmentsPanel
                advanceId={record.id}
                noShipmentsLabel={t('advances.no_shipments')}
                cargoCodeLabel={t('advances.cargo_code')}
                allocatedAmountLabel={t('advances.allocated_amount')}
              />
            </div>
          ),
        }}
      />

      {/* New advance modal */}
      <NewAdvanceModal
        open={newAdvanceOpen}
        onClose={() => setNewAdvanceOpen(false)}
      />
    </div>
  );
}
