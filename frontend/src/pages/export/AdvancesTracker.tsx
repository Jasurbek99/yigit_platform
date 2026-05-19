import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { IconCurrencyDollar, IconPlus } from '@tabler/icons-react';
import dayjs, { type Dayjs } from 'dayjs';
import { toast } from 'sonner';
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
import { COLORS, FONT } from '@/constants/styles';

const { Text, Link } = Typography;

type ReconcileFilter = 'all' | 'pending' | 'reconciled';

const CAN_CREATE_ROLES = new Set(['finansist', 'export_manager', 'director']);

interface ILinkedShipmentsProps {
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
}: ILinkedShipmentsProps) {
  const { data, isLoading } = useAdvanceDetail(advanceId);

  const links: IAdvanceShipmentLink[] = data?.shipment_links ?? [];

  if (!isLoading && links.length === 0) {
    return <Text type="secondary">{noShipmentsLabel}</Text>;
  }

  const cols: ProColumns<IAdvanceShipmentLink>[] = [
    {
      title: cargoCodeLabel,
      dataIndex: 'shipment_cargo_code',
      search: false,
    },
    {
      title: allocatedAmountLabel,
      dataIndex: 'allocated_amount',
      search: false,
      render: (_, record) =>
        record.allocated_amount != null ? `$${record.allocated_amount.toLocaleString()}` : '—',
    },
  ];

  return (
    <div style={{ maxWidth: 480 }}>
      <ProTable<IAdvanceShipmentLink>
        rowKey="shipment"
        dataSource={links}
        columns={cols}
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        size="small"
        locale={{ emptyText: noShipmentsLabel }}
      />
    </div>
  );
}

interface INewAdvanceFormValues {
  batch_code?: string;
  advance_date: Dayjs | null;
  total_amount: number | null;
  currency: string;
  purpose?: string;
  notes?: string;
}

interface INewAdvanceModalProps {
  open: boolean;
  onClose: () => void;
}

function NewAdvanceModal({ open, onClose }: INewAdvanceModalProps) {
  const { t } = useTranslation();
  const createAdvance = useCreateAdvance();
  const [form] = Form.useForm<INewAdvanceFormValues>();

  function handleSubmit(values: INewAdvanceFormValues) {
    const payload: ICreateAdvancePayload = {
      batch_code: values.batch_code || undefined,
      advance_date: values.advance_date ? values.advance_date.format('YYYY-MM-DD') : '',
      total_amount: Number(values.total_amount ?? 0),
      currency: values.currency,
      purpose: values.purpose || undefined,
      notes: values.notes || undefined,
    } as ICreateAdvancePayload;

    createAdvance.mutate(payload, {
      onSuccess: () => {
        toast.success(t('advances.create_success'));
        form.resetFields();
        onClose();
      },
      onError: () => {
        toast.error(t('advances.error_load'));
      },
    });
  }

  function handleCancel() {
    form.resetFields();
    onClose();
  }

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={t('advances.new_advance')}
      footer={null}
      destroyOnClose
    >
      <Form<INewAdvanceFormValues>
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ currency: 'USD' }}
      >
        <Form.Item name="batch_code" label={t('advances.batch_code')}>
          <Input placeholder={t('advances.batch_code_placeholder')} />
        </Form.Item>
        <Form.Item
          name="advance_date"
          label={t('advances.date')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="total_amount"
          label={t('advances.amount')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <InputNumber<number>
            min={0}
            precision={2}
            prefix="$"
            style={{ width: '100%' }}
            formatter={(value) => (value != null ? `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '')}
            parser={(value): number => {
              const cleaned = (value ?? '').replace(/,/g, '');
              const n = Number(cleaned);
              return Number.isFinite(n) ? n : 0;
            }}
          />
        </Form.Item>
        <Form.Item
          name="currency"
          label={t('advances.currency')}
          rules={[{ required: true, message: t('common.required') }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="purpose" label={t('advances.purpose')}>
          <Input />
        </Form.Item>
        <Form.Item name="notes" label={t('advances.notes')}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button onClick={handleCancel}>{t('common.cancel')}</Button>
          <Button type="primary" htmlType="submit" loading={createAdvance.isPending}>
            {t('advances.new_advance')}
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <Card size="small">
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{title}</Text>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </Card>
  );
}

export default function AdvancesTracker() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [filter, setFilter] = useState<ReconcileFilter>('all');
  const [newAdvanceOpen, setNewAdvanceOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<readonly React.Key[]>([]);

  const reconcileFilter =
    filter === 'all' ? undefined : filter === 'reconciled' ? true : false;

  const { data, isLoading, isError } = useAdvances({ reconciled: reconcileFilter });
  const reconcileAdvance = useReconcileAdvance();

  const advances = useMemo(() => data?.results ?? [], [data?.results]);

  const { totalCount, totalAmount, unreconciledCount, unreconciledAmount } =
    useMemo(() => {
      const unreconciled = advances.filter((a) => !a.reconciled);
      return {
        totalCount: data?.count ?? 0,
        totalAmount: advances.reduce((sum, a) => sum + a.total_amount, 0),
        unreconciledCount: unreconciled.length,
        unreconciledAmount: unreconciled.reduce((sum, a) => sum + a.total_amount, 0),
      };
    }, [advances, data?.count]);

  const canCreate = user ? CAN_CREATE_ROLES.has(user.role) : false;

  function handleReconcile(id: number) {
    reconcileAdvance.mutate(id, {
      onSuccess: () => toast.success(t('advances.reconciled')),
      onError: () => toast.error(t('advances.error_load')),
    });
  }

  const columns: ProColumns<IFinansistAdvanceListItem>[] = [
    {
      title: t('advances.batch_code'),
      dataIndex: 'batch_code',
      width: 150,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.batch_code ?? '').localeCompare(b.batch_code ?? ''),
      render: (_, record) =>
        record.batch_code ? (
          <Link style={{ fontFamily: FONT.mono }}>{record.batch_code}</Link>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('advances.date'),
      dataIndex: 'advance_date',
      width: 110,
      search: false,
      sorter: (a, b) => a.advance_date.localeCompare(b.advance_date),
      defaultSortOrder: 'descend',
      render: (_, record) => dayjs(record.advance_date).format('DD.MM.YYYY'),
    },
    {
      title: t('advances.amount'),
      dataIndex: 'total_amount',
      width: 130,
      search: false,
      sorter: (a, b) => a.total_amount - b.total_amount,
      render: (_, record) => (
        <Text strong>${record.total_amount.toLocaleString()}</Text>
      ),
    },
    {
      title: t('advances.currency'),
      dataIndex: 'currency',
      width: 90,
      search: false,
      responsive: ['md'],
    },
    {
      title: t('advances.purpose'),
      dataIndex: 'purpose',
      search: false,
      responsive: ['md'],
      render: (_, record) => record.purpose ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('advances.shipments'),
      dataIndex: 'shipment_count',
      width: 100,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => a.shipment_count - b.shipment_count,
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
      search: false,
      responsive: ['md'],
      sorter: (a, b) => a.allocated_total - b.allocated_total,
      render: (_, record) => {
        const isOver = record.allocated_total > record.total_amount;
        return (
          <span style={{ color: isOver ? COLORS.danger : undefined }}>
            ${record.allocated_total.toLocaleString()}
          </span>
        );
      },
    },
    {
      title: t('advances.status'),
      dataIndex: 'reconciled',
      width: 120,
      search: false,
      sorter: (a, b) => Number(a.reconciled) - Number(b.reconciled),
      render: (_, record) =>
        record.reconciled ? (
          <Tag color="green">{t('advances.reconciled')}</Tag>
        ) : (
          <Tag color="orange">{t('advances.pending')}</Tag>
        ),
    },
    {
      title: t('advances.issued_by'),
      dataIndex: 'issued_by_name',
      width: 120,
      search: false,
      responsive: ['md'],
      sorter: (a, b) => (a.issued_by_name ?? '').localeCompare(b.issued_by_name ?? ''),
    },
    {
      title: t('advances.reconcile'),
      key: 'reconcile_action',
      width: 100,
      search: false,
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

  if (isError) {
    return (
      <Alert type="error" message={t('advances.error_load')} showIcon style={{ margin: 16 }} />
    );
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: COLORS.textDark, lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconCurrencyDollar size={18} color={COLORS.primary} />
            {t('advances.title')}
          </div>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
            {t('advances.subtitle')}
          </div>
        </div>
        {canCreate && (
          <Button
            type="primary"
            icon={<IconPlus size={14} />}
            onClick={() => setNewAdvanceOpen(true)}
          >
            {t('advances.new_advance')}
          </Button>
        )}
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <StatCard title={t('advances.total_advances')} value={totalCount} />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard title={t('advances.total_amount')} value={`$${totalAmount.toLocaleString()}`} />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard
            title={t('advances.unreconciled')}
            value={unreconciledCount}
            color={unreconciledCount > 0 ? COLORS.orange : undefined}
          />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard
            title={t('advances.unreconciled_amount')}
            value={`$${unreconciledAmount.toLocaleString()}`}
            color={unreconciledAmount > 0 ? COLORS.orange : undefined}
          />
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Radio.Group
          value={filter}
          onChange={(e) => setFilter(e.target.value as ReconcileFilter)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: t('advances.all'), value: 'all' },
            { label: t('advances.pending'), value: 'pending' },
            { label: t('advances.reconciled'), value: 'reconciled' },
          ]}
        />
      </Space>

      <ProTable<IFinansistAdvanceListItem>
        rowKey="id"
        dataSource={advances}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        size="small"
        locale={{ emptyText: t('advances.empty') }}
        expandable={{
          expandedRowKeys: expandedIds,
          onExpandedRowsChange: (keys) => setExpandedIds(keys),
          expandedRowRender: (record) => (
            <div style={{ padding: '8px 0 8px 16px' }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                {t('advances.linked_shipments')}
              </Text>
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

      <NewAdvanceModal
        open={newAdvanceOpen}
        onClose={() => setNewAdvanceOpen(false)}
      />
    </div>
  );
}
