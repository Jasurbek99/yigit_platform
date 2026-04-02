import { useParams, useNavigate } from 'react-router-dom';
import {
  Button,
  Checkbox,
  Descriptions,
  Flex,
  Form,
  InputNumber,
  Input,
  Skeleton,
  Alert,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import type { DescriptionsProps, TableColumnsType } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { StatusTag } from '@/components/StatusTag';
import { TransitionButton } from '@/components/TransitionButton';
import { CommentComposer } from '@/components/CommentComposer';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useAuth } from '@/hooks/useAuth';
import api from '@/services/api';
import type {
  IFirmSplit,
  IBlockSource,
  IStatusLogEntry,
  IShipmentComment,
  IShipmentQuality,
  ISalesReport,
} from '@/types';

const { Text, Title } = Typography;

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmt(val: string | null | undefined): string {
  if (!val) return '—';
  return dayjs(val).format('DD.MM.YYYY HH:mm');
}

function fmtDate(val: string | null | undefined): string {
  if (!val) return '—';
  return dayjs(val).format('DD.MM.YYYY');
}

function fmtNum(val: number | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

// ─── SalesReportForm ──────────────────────────────────────────────────────────

interface SalesReportFormProps {
  shipmentId: string;
  report: ISalesReport | null | undefined;
  canEdit: boolean;
}

function SalesReportForm({ shipmentId, report, canEdit }: SalesReportFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<Partial<ISalesReport>>();

  const mutation = useMutation({
    mutationFn: async (values: Partial<ISalesReport>) => {
      await api.post(`/export/shipments/${shipmentId}/sales-report/`, values);
    },
    onSuccess: () => {
      toast.success(t('sales_report.toast_success'));
      void queryClient.invalidateQueries({ queryKey: ['shipment', shipmentId] });
    },
    onError: () => {
      toast.error(t('sales_report.toast_error'));
    },
  });

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={report ?? {}}
      onFinish={(values) => mutation.mutate(values)}
      style={{ maxWidth: 640, marginTop: 16 }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <Form.Item name="price_per_kg" label={t('sales_report.price_per_kg')}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
        </Form.Item>
        <Form.Item name="total_usd" label={t('sales_report.total_usd')}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
        </Form.Item>
        <Form.Item name="weight_sold_kg" label={t('sales_report.weight_sold')}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
        </Form.Item>
        <Form.Item name="weight_rejected_kg" label={t('sales_report.weight_rejected')}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
        </Form.Item>
        <Form.Item name="transport_cost_usd" label={t('sales_report.transport_cost')}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
        </Form.Item>
        <Form.Item name="market_fee_usd" label={t('sales_report.market_fee')}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
        </Form.Item>
        <Form.Item name="other_expenses_usd" label={t('sales_report.other_expenses')}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
        </Form.Item>
      </div>
      <Form.Item name="notes" label={t('sales_report.notes')}>
        <Input.TextArea rows={3} disabled={!canEdit} />
      </Form.Item>
      {canEdit && (
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            {t('sales_report.submit')}
          </Button>
        </Form.Item>
      )}
    </Form>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: shipment, isLoading, isError } = useShipmentDetail(id);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const qualityMutation = useMutation({
    mutationFn: async ({ field, checked }: { field: keyof IShipmentQuality; checked: boolean }) => {
      await api.patch(`/export/shipments/${id}/quality/`, { [field]: checked });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shipment', id] });
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (isError || !shipment) {
    return <Alert type="error" message={t('shipment_detail.error_load')} style={{ margin: 24 }} />;
  }

  const canEditQuality =
    user?.role === 'export_manager' ||
    user?.role === 'document_team' ||
    user?.role === 'director';

  const canEditSalesReport =
    user?.role === 'sales_rep' ||
    user?.role === 'export_manager' ||
    user?.role === 'director';

  const q: IShipmentQuality = shipment.quality ?? {
    azyk_maglumatnama: false,
    suriji_gozukdiriji: false,
    hil_sertifikaty: false,
    kalibrowka_analiz: false,
  };

  const qualityFields: (keyof IShipmentQuality)[] = [
    'azyk_maglumatnama',
    'suriji_gozukdiriji',
    'hil_sertifikaty',
    'kalibrowka_analiz',
  ];

  const isReportAvailable =
    shipment.status_code === 'hasabat' || shipment.status_code === 'tamamlandy';

  // ── Overview Descriptions ──────────────────────────────────────────────────

  const coreDescItems: DescriptionsProps['items'] = [
    { key: 'cargo_code', label: t('shipment_detail.cargo_code'), children: <strong style={{ fontFamily: 'monospace' }}>{shipment.cargo_code}</strong> },
    { key: 'date', label: t('shipment_detail.date'), children: fmtDate(shipment.date) },
    { key: 'status', label: t('shipment_detail.status'), children: <StatusTag statusDisplay={shipment.status_display} /> },
    { key: 'customer', label: t('shipment_detail.customer'), children: shipment.customer_name ?? '—' },
    { key: 'country', label: t('shipment_detail.country'), children: shipment.country_name ?? '—' },
    {
      key: 'gapy_satys',
      label: t('shipment_detail.gapy_satys'),
      children: shipment.is_gapy_satys
        ? <Tag color="orange">{t('shipment_detail.yes')}</Tag>
        : <Tag color="default">{t('shipment_detail.no')}</Tag>,
    },
  ];

  const weightDescItems: DescriptionsProps['items'] = [
    { key: 'weight_net', label: t('shipment_detail.weight_net'), children: `${fmtNum(shipment.weight_net)} kg` },
    { key: 'weight_gross', label: t('shipment_detail.weight_gross'), children: `${fmtNum(shipment.weight_gross)} kg` },
    { key: 'packaging', label: t('shipment_detail.packaging'), children: `${fmtNum(shipment.packaging_kg)} kg` },
    { key: 'boxes', label: t('shipment_detail.boxes'), children: fmtNum(shipment.box_count) },
    { key: 'pallets', label: t('shipment_detail.pallets'), children: fmtNum(shipment.pallet_count) },
    {
      key: 'price_per_kg',
      label: t('shipment_detail.price_per_kg'),
      children: shipment.price_per_kg != null ? `$${shipment.price_per_kg}` : '—',
    },
    {
      key: 'total_usd',
      label: t('shipment_detail.total_usd'),
      children: shipment.total_amount_usd != null ? `$${fmtNum(shipment.total_amount_usd)}` : '—',
    },
    { key: 'notes', label: t('shipment_detail.notes'), children: shipment.notes ?? '—', span: 2 },
  ];

  // ── Logistics Descriptions ─────────────────────────────────────────────────

  const logisticsDescItems: DescriptionsProps['items'] = [
    { key: 'vehicle_condition', label: t('shipment_detail.vehicle_condition'), children: shipment.vehicle_condition ?? '—' },
    { key: 'condition_note', label: t('shipment_detail.condition_note'), children: shipment.vehicle_condition_note ?? '—' },
    { key: 'route_note', label: t('shipment_detail.route_note'), children: shipment.route_note ?? '—', span: 2 },
    { key: 'loading_started', label: t('shipment_detail.loading_started'), children: fmt(shipment.loading_started_at) },
    { key: 'customs_entry', label: t('shipment_detail.customs_entry'), children: fmt(shipment.customs_entry_at) },
    { key: 'customs_exit', label: t('shipment_detail.customs_exit'), children: fmt(shipment.customs_exit_at) },
    { key: 'departed', label: t('shipment_detail.departed'), children: fmt(shipment.departed_at) },
    { key: 'border_crossed', label: t('shipment_detail.border_crossed'), children: fmt(shipment.border_crossed_at) },
    { key: 'arrived', label: t('shipment_detail.arrived'), children: fmt(shipment.arrived_at) },
    { key: 'sale_started', label: t('shipment_detail.sale_started'), children: fmt(shipment.sale_started_at) },
    { key: 'sale_ended', label: t('shipment_detail.sale_ended'), children: fmt(shipment.sale_ended_at) },
  ];

  // ── Firm Splits table ──────────────────────────────────────────────────────

  const firmSplitColumns: TableColumnsType<IFirmSplit> = [
    { title: t('shipment_detail.firm_splits_col_firm'), dataIndex: 'export_firm_name' },
    { title: t('shipment_detail.weight_net'), dataIndex: 'weight_kg', render: (v) => fmtNum(v as number) },
    { title: t('shipment_detail.total_usd'), dataIndex: 'amount_usd', render: (v) => fmtNum(v as number) },
    { title: t('shipment_detail.firm_splits_col_invoice'), dataIndex: 'invoice_number', render: (v) => (v as string) ?? '—' },
  ];

  const blockColumns: TableColumnsType<IBlockSource> = [
    { title: t('shipment_detail.block_sources_col_code'), dataIndex: 'block_code' },
    { title: t('shipment_detail.block_sources_col_name'), dataIndex: 'block_name' },
    { title: t('shipment_detail.weight_net'), dataIndex: 'weight_kg', render: (v) => fmtNum(v as number) },
  ];

  // ── Sales Report display ───────────────────────────────────────────────────

  const salesReportDescItems: DescriptionsProps['items'] = shipment.sales_report
    ? [
        { key: 'price_per_kg', label: t('sales_report.price_per_kg'), children: shipment.sales_report.price_per_kg ?? '—' },
        { key: 'total_usd', label: t('sales_report.total_usd'), children: shipment.sales_report.total_usd ?? '—' },
        { key: 'weight_sold', label: t('sales_report.weight_sold'), children: shipment.sales_report.weight_sold_kg ?? '—' },
        { key: 'weight_rejected', label: t('sales_report.weight_rejected'), children: shipment.sales_report.weight_rejected_kg ?? '—' },
        { key: 'transport_cost', label: t('sales_report.transport_cost'), children: shipment.sales_report.transport_cost_usd ?? '—' },
        { key: 'market_fee', label: t('sales_report.market_fee'), children: shipment.sales_report.market_fee_usd ?? '—' },
        { key: 'other_expenses', label: t('sales_report.other_expenses'), children: shipment.sales_report.other_expenses_usd ?? '—' },
        { key: 'notes', label: t('sales_report.notes'), children: shipment.sales_report.notes ?? '—', span: 2 },
      ]
    : [];

  const tabItems = [
    {
      key: 'overview',
      label: t('shipment_detail.tab_overview'),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Descriptions title="Esasy maglumatlar" bordered size="small" column={2} items={coreDescItems} />
          <Descriptions title="Agram we baha" bordered size="small" column={2} items={weightDescItems} />
          {shipment.firm_splits.length > 0 && (
            <div>
              <Title level={5} style={{ marginBottom: 8 }}>{t('shipment_detail.firm_splits')}</Title>
              <Table<IFirmSplit>
                dataSource={shipment.firm_splits}
                columns={firmSplitColumns}
                rowKey="export_firm_id"
                size="small"
                pagination={false}
              />
            </div>
          )}
          {shipment.block_sources.length > 0 && (
            <div>
              <Title level={5} style={{ marginBottom: 8 }}>{t('shipment_detail.block_sources')}</Title>
              <Table<IBlockSource>
                dataSource={shipment.block_sources}
                columns={blockColumns}
                rowKey="block_code"
                size="small"
                pagination={false}
              />
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'logistics',
      label: t('shipment_detail.tab_logistics'),
      children: (
        <Descriptions
          title="Ulag maglumatlary"
          bordered
          size="small"
          column={2}
          items={logisticsDescItems}
        />
      ),
    },
    {
      key: 'quality',
      label: t('shipment_detail.tab_quality'),
      children: (
        <div>
          <Title level={5} style={{ marginBottom: 12 }}>{t('quality.title')}</Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {qualityFields.map((field) => (
              <Checkbox
                key={field}
                checked={q[field]}
                disabled={!canEditQuality || qualityMutation.isPending}
                onChange={(e) => qualityMutation.mutate({ field, checked: e.target.checked })}
              >
                {t(`quality.${field}`)}
              </Checkbox>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: 'comments',
      label: t('shipment_detail.tab_comments', { count: shipment.comments.length }),
      children: (
        <div>
          {shipment.comments.length === 0 ? (
            <Text type="secondary">{t('shipment_detail.no_comments')}</Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {shipment.comments.map((c: IShipmentComment) => (
                <div
                  key={c.id}
                  style={{
                    background: '#fafafa',
                    borderRadius: 6,
                    padding: '10px 14px',
                    border: '1px solid #f0f0f0',
                  }}
                >
                  <Flex gap={8} align="center" wrap="wrap">
                    <Text strong style={{ fontSize: 13 }}>{c.user_name}</Text>
                    <Tag style={{ margin: 0, fontSize: 11 }}>{c.role}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>{fmt(c.created_at)}</Text>
                  </Flex>
                  <div style={{ marginTop: 6, fontSize: 13 }}>{c.content}</div>
                </div>
              ))}
            </div>
          )}
          <CommentComposer shipmentId={shipment.id} />
        </div>
      ),
    },
    {
      key: 'history',
      label: t('shipment_detail.tab_history', { count: shipment.status_log.length }),
      children: (
        <Timeline
          items={shipment.status_log.map((entry: IStatusLogEntry) => ({
            children: (
              <div>
                <Flex gap={8} align="center" wrap="wrap">
                  <StatusTag statusDisplay={entry.status_display} />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {fmt(entry.changed_at)} — {t('shipment_detail.history_by', { name: entry.changed_by_name })}
                  </Text>
                </Flex>
                {entry.comment && (
                  <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                    {entry.comment}
                  </Text>
                )}
              </div>
            ),
          }))}
        />
      ),
    },
    {
      key: 'sales_report',
      label: t('sales_report.tab'),
      children: !isReportAvailable ? (
        <Text type="secondary" style={{ display: 'block', padding: '24px 0' }}>
          {t('sales_report.only_at_hasabat')}
        </Text>
      ) : (
        <div>
          {shipment.sales_report && salesReportDescItems.length > 0 && (
            <Descriptions bordered size="small" column={2} items={salesReportDescItems} style={{ marginBottom: 16 }} />
          )}
          {!shipment.sales_report && (
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>{t('sales_report.empty')}</Text>
          )}
          {canEditSalesReport && (
            <SalesReportForm
              shipmentId={String(shipment.id)}
              report={shipment.sales_report}
              canEdit={canEditSalesReport}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Page header */}
      <Flex align="center" gap={12} wrap="wrap" style={{ marginBottom: 20 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/export/shipments')}
        />
        <Text strong style={{ fontSize: 17, letterSpacing: '-0.01em' }}>
          {shipment.cargo_code}
        </Text>
        <StatusTag statusDisplay={shipment.status_display} />
        {shipment.allowed_transitions && shipment.allowed_transitions.length > 0 && (
          <div style={{ marginLeft: 'auto' }}>
            <TransitionButton
              shipmentId={shipment.id}
              allowedTransitions={shipment.allowed_transitions}
            />
          </div>
        )}
      </Flex>

      <Tabs items={tabItems} defaultActiveKey="overview" />
    </div>
  );
}
