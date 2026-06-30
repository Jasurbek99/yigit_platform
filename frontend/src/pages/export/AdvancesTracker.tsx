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
  Popconfirm,
  Radio,
  Row,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { IconCurrencyDollar, IconPlus, IconTrash } from '@tabler/icons-react';
import dayjs, { type Dayjs } from 'dayjs';
import { toast } from 'sonner';
import {
  useAdvances,
  useAdvanceDetail,
  useReconcileAdvance,
  useCreateAdvance,
  useLinkShipmentToAdvance,
  useUnlinkShipmentFromAdvance,
} from '@/hooks/useAdvances';
import type { ICreateAdvancePayload } from '@/hooks/useAdvances';
import type {
  IFinansistAdvanceListItem,
  IAdvanceShipmentLink,
} from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { useCustomsLedger } from '@/hooks/useCustomsExpenses';
import { CustomsLedgerSummary } from '@/components/customsExpense/CustomsLedgerSummary';
import { CustomsExpensesTab, CUSTOMS_EXPENSE_WRITE_ROLES } from '@/components/customsExpense/CustomsExpensesTab';
import { ShipmentMultiSelect } from '@/components/ShipmentMultiSelect';
import { ShipmentSelect } from '@/components/ShipmentSelect';
import { COLORS, FONT } from '@/constants/styles';

const { Text, Link } = Typography;
const { RangePicker } = DatePicker;

type ReconcileFilter = 'all' | 'pending' | 'reconciled';

/** Roles that may create advances (money-IN). Separate from customs-expense writers. */
const CAN_CREATE_ROLES = new Set(['finansist', 'export_manager', 'director']);

/** Group-separated amount + currency code (e.g. "35 640 TMT"). */
function formatMoney(amount: number, currency?: string): string {
  const num = Number(amount ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return currency ? `${num} ${currency}` : num;
}

// ─── LinkedShipmentsPanel ────────────────────────────────────────────────────

interface ILinkedShipmentsProps {
  advanceId: number;
  canEdit: boolean;
  noShipmentsLabel: string;
  shipmentCodeLabel: string;
  allocatedAmountLabel: string;
}

function LinkedShipmentsPanel({
  advanceId,
  canEdit,
  noShipmentsLabel,
  shipmentCodeLabel,
  allocatedAmountLabel,
}: ILinkedShipmentsProps): React.ReactElement {
  const { t } = useTranslation();
  const { data, isLoading } = useAdvanceDetail(advanceId);
  const linkShipment = useLinkShipmentToAdvance();
  const unlinkShipment = useUnlinkShipmentFromAdvance();

  const [pickedShipment, setPickedShipment] = useState<number | null>(null);
  const [allocated, setAllocated] = useState<number | null>(null);

  const links: IAdvanceShipmentLink[] = data?.shipment_links ?? [];
  const linkedIds = new Set(links.map((l) => l.shipment));

  function handleAttach(): void {
    if (pickedShipment == null) return;
    if (linkedIds.has(pickedShipment)) {
      toast.error(t('advances.already_linked'));
      return;
    }
    linkShipment.mutate(
      { advanceId, shipment_id: pickedShipment, allocated_amount: allocated },
      {
        onSuccess: () => {
          toast.success(t('advances.attach_success'));
          setPickedShipment(null);
          setAllocated(null);
        },
        onError: () => toast.error(t('advances.attach_error')),
      },
    );
  }

  function handleUnlink(shipmentId: number): void {
    unlinkShipment.mutate(
      { advanceId, shipmentId },
      {
        onSuccess: () => toast.success(t('advances.unlink_success')),
        onError: () => toast.error(t('advances.attach_error')),
      },
    );
  }

  const cols: ProColumns<IAdvanceShipmentLink>[] = [
    {
      title: shipmentCodeLabel,
      dataIndex: 'shipment_code',
      search: false,
    },
    {
      title: allocatedAmountLabel,
      dataIndex: 'allocated_amount',
      search: false,
      render: (_, record) =>
        record.allocated_amount != null
          ? Number(record.allocated_amount).toLocaleString()
          : '—',
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 48,
            search: false,
            render: (_, record) => (
              <Popconfirm
                title={t('advances.unlink_confirm')}
                onConfirm={() => handleUnlink(record.shipment)}
                okText={t('common.yes')}
                cancelText={t('common.no')}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<IconTrash size={16} />}
                  loading={unlinkShipment.isPending}
                />
              </Popconfirm>
            ),
          } as ProColumns<IAdvanceShipmentLink>,
        ]
      : []),
  ];

  return (
    <div style={{ maxWidth: 520 }}>
      {links.length === 0 && !isLoading ? (
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {noShipmentsLabel}
        </Text>
      ) : (
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
      )}

      {canEdit && (
        <Space.Compact style={{ width: '100%', marginTop: 8 }}>
          <ShipmentSelect
            value={pickedShipment}
            onChange={setPickedShipment}
            placeholder={t('advances.attach_placeholder')}
            size="small"
            style={{ flex: 1 }}
          />
          <InputNumber<number>
            value={allocated ?? undefined}
            onChange={(v) => setAllocated(v ?? null)}
            min={0}
            precision={2}
            size="small"
            placeholder={allocatedAmountLabel}
            style={{ width: 140 }}
          />
          <Button
            type="primary"
            size="small"
            onClick={handleAttach}
            loading={linkShipment.isPending}
            disabled={pickedShipment == null}
          >
            {t('advances.attach')}
          </Button>
        </Space.Compact>
      )}
    </div>
  );
}

// ─── NewAdvanceModal ──────────────────────────────────────────────────────────

interface INewAdvanceFormValues {
  batch_code?: string;
  advance_date: Dayjs | null;
  total_amount: number | null;
  currency: string;
  purpose?: string;
  notes?: string;
  shipment_ids?: number[];
}

interface INewAdvanceModalProps {
  open: boolean;
  onClose: () => void;
}

function NewAdvanceModal({ open, onClose }: INewAdvanceModalProps): React.ReactElement {
  const { t } = useTranslation();
  const createAdvance = useCreateAdvance();
  const [form] = Form.useForm<INewAdvanceFormValues>();

  function handleSubmit(values: INewAdvanceFormValues): void {
    const payload: ICreateAdvancePayload = {
      batch_code: values.batch_code || undefined,
      advance_date: values.advance_date ? values.advance_date.format('YYYY-MM-DD') : '',
      total_amount: Number(values.total_amount ?? 0),
      currency: values.currency,
      purpose: values.purpose || undefined,
      notes: values.notes || undefined,
      shipment_ids: values.shipment_ids?.length ? values.shipment_ids : undefined,
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

  function handleCancel(): void {
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
            formatter={(value) =>
              value != null ? `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''
            }
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
        <Form.Item
          name="shipment_ids"
          label={t('advances.link_shipments')}
          tooltip={t('advances.link_shipments_help')}
        >
          <ShipmentMultiSelect
            placeholder={t('advances.link_shipments_placeholder')}
            style={{ width: '100%' }}
          />
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

// ─── StatCard ────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  color,
}: {
  title: string;
  value: string | number;
  color?: string;
}): React.ReactElement {
  return (
    <Card size="small">
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {title}
      </Text>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </Card>
  );
}

// ─── AdvancesTab ─────────────────────────────────────────────────────────────

interface IAdvancesTabProps {
  canCreate: boolean;
}

function AdvancesTab({ canCreate }: IAdvancesTabProps): React.ReactElement {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ReconcileFilter>('all');
  const [newAdvanceOpen, setNewAdvanceOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<readonly React.Key[]>([]);

  const reconcileFilter =
    filter === 'all' ? undefined : filter === 'reconciled' ? true : false;

  const { data, isLoading, isError } = useAdvances({ reconciled: reconcileFilter });
  const reconcileAdvance = useReconcileAdvance();

  const advances = useMemo(() => data?.results ?? [], [data?.results]);

  const {
    totalCount,
    totalAmount,
    unreconciledCount,
    unreconciledAmount,
    summaryCurrency,
  } = useMemo(() => {
    const unreconciled = advances.filter((a) => !a.reconciled);
    const currencies = new Set(advances.map((a) => a.currency));
    return {
      totalCount: data?.count ?? 0,
      totalAmount: advances.reduce((sum, a) => sum + Number(a.total_amount), 0),
      unreconciledCount: unreconciled.length,
      unreconciledAmount: unreconciled.reduce(
        (sum, a) => sum + Number(a.total_amount),
        0,
      ),
      // Show the currency code only when every loaded advance shares one.
      summaryCurrency: currencies.size === 1 ? [...currencies][0] : undefined,
    };
  }, [advances, data?.count]);

  function handleReconcile(id: number): void {
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
        <Text strong>{formatMoney(record.total_amount)}</Text>
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
            {formatMoney(record.allocated_total)}
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
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <StatCard title={t('advances.total_advances')} value={totalCount} />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard
            title={t('advances.total_amount')}
            value={formatMoney(totalAmount, summaryCurrency)}
          />
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
            value={formatMoney(unreconciledAmount, summaryCurrency)}
            color={unreconciledAmount > 0 ? COLORS.orange : undefined}
          />
        </Col>
      </Row>

      <Space style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
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
              <Text
                type="secondary"
                style={{ display: 'block', marginBottom: 8, fontSize: 13 }}
              >
                {t('advances.linked_shipments')}
              </Text>
              <LinkedShipmentsPanel
                advanceId={record.id}
                canEdit={canCreate}
                noShipmentsLabel={t('advances.no_shipments')}
                shipmentCodeLabel={t('advances.shipment_code')}
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
    </>
  );
}

// ─── AdvancesTracker (page root) ─────────────────────────────────────────────

export default function AdvancesTracker(): React.ReactElement {
  const { t } = useTranslation();
  const { user } = useAuth();

  // Shared date range: filters both the ledger summary and the expenses tab.
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [dateFrom, dateTo] = dateRange;

  const ledgerFilters = {
    date_from: dateFrom ? dateFrom.format('YYYY-MM-DD') : undefined,
    date_to: dateTo ? dateTo.format('YYYY-MM-DD') : undefined,
  };

  const { data: ledger, isLoading: ledgerLoading } = useCustomsLedger(ledgerFilters);

  const canCreateAdvance = user ? CAN_CREATE_ROLES.has(user.role) : false;
  const canWriteExpense =
    (user ? CUSTOMS_EXPENSE_WRITE_ROLES.has(user.role) : false) ||
    user?.is_superuser === true;

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: COLORS.textDark,
            lineHeight: '1.3',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <IconCurrencyDollar size={18} color={COLORS.primary} />
          {t('advances.title')}
        </div>
        <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
          {t('advances.subtitle')}
        </div>
      </div>

      {/* Shared date-range filter — applies to ledger tiles AND expenses tab */}
      <Space style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('customs_expense.date_range')}:
        </Text>
        <RangePicker
          format="DD.MM.YYYY"
          value={dateRange}
          onChange={(vals) =>
            setDateRange(vals ? [vals[0], vals[1]] : [null, null])
          }
          allowClear
          size="small"
        />
      </Space>

      {/* Ledger TMT summary (above tabs — currency: TMT, separate from USD advances) */}
      <CustomsLedgerSummary ledger={ledger} isLoading={ledgerLoading} />

      {/* Tabbed view */}
      <Tabs
        defaultActiveKey="advances"
        items={[
          {
            key: 'advances',
            label: t('customs_expense.tab_advances'),
            children: <AdvancesTab canCreate={canCreateAdvance} />,
          },
          {
            key: 'expenses',
            label: t('customs_expense.tab_expenses'),
            children: (
              <CustomsExpensesTab
                canWrite={canWriteExpense}
                dateFrom={dateFrom}
                dateTo={dateTo}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
