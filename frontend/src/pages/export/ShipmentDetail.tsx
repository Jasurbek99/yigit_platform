import { useParams, useNavigate } from 'react-router-dom';
import {
  Button,
  Checkbox,
  Descriptions,
  Form,
  Input,
  InputNumber,
  message,
  Skeleton,
  Tabs,
  Tag,
  Timeline,
  Typography,
  Alert,
  Space,
  Table,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusTag } from '@/components/StatusTag';
import { TransitionButton } from '@/components/TransitionButton';
import { CommentComposer } from '@/components/CommentComposer';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useAuth } from '@/hooks/useAuth';
import api from '@/services/api';
import type { IFirmSplit, IBlockSource, IStatusLogEntry, IShipmentComment, IShipmentQuality, ISalesReport } from '@/types';

const { Title, Text } = Typography;

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

function fmtDecimal(val: string | null | undefined): string {
  if (!val) return '—';
  return val;
}

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

  const salesReportMutation = useMutation({
    mutationFn: async (values: Partial<ISalesReport>) => {
      await api.post(`/export/shipments/${id}/sales-report/`, values);
    },
    onSuccess: () => {
      void message.success(t('sales_report.toast_success'));
      void queryClient.invalidateQueries({ queryKey: ['shipment', id] });
    },
    onError: () => {
      void message.error(t('sales_report.toast_error'));
    },
  });

  const [salesReportForm] = Form.useForm<Partial<ISalesReport>>();

  if (isLoading) return <Skeleton active style={{ padding: 24 }} />;
  if (isError || !shipment) {
    return <Alert type="error" message={t('shipment_detail.error_load')} style={{ margin: 24 }} />;
  }

  const firmSplitColumns = [
    { title: t('shipment_detail.firm_splits_col_firm'), dataIndex: 'export_firm_name', key: 'firm' },
    { title: t('shipment_detail.weight_net'), dataIndex: 'weight_kg', key: 'weight', render: fmtNum },
    { title: t('shipment_detail.total_usd'), dataIndex: 'amount_usd', key: 'amount', render: fmtNum },
    { title: t('shipment_detail.firm_splits_col_invoice'), dataIndex: 'invoice_number', key: 'invoice', render: (v: string | null) => v ?? '—' },
  ];

  const blockColumns = [
    { title: t('shipment_detail.block_sources_col_code'), dataIndex: 'block_code', key: 'code' },
    { title: t('shipment_detail.block_sources_col_name'), dataIndex: 'block_name', key: 'name' },
    { title: t('shipment_detail.weight_net'), dataIndex: 'weight_kg', key: 'weight', render: fmtNum },
  ];

  const tabItems = [
    {
      key: 'overview',
      label: t('shipment_detail.tab_overview'),
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Descriptions bordered column={{ xs: 1, sm: 2, md: 3 }} size="small">
            <Descriptions.Item label={t('shipment_detail.cargo_code')}>
              <strong>{shipment.cargo_code}</strong>
            </Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.date')}>{fmtDate(shipment.date)}</Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.status')}>
              <StatusTag statusDisplay={shipment.status_display} />
            </Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.customer')}>{shipment.customer_name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.country')}>{shipment.country_name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.gapy_satys')}>
              {shipment.is_gapy_satys ? <Tag color="orange">{t('shipment_detail.yes')}</Tag> : <Tag>{t('shipment_detail.no')}</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.weight_net')}>{fmtNum(shipment.weight_net)} kg</Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.weight_gross')}>{fmtNum(shipment.weight_gross)} kg</Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.packaging')}>{fmtNum(shipment.packaging_kg)} kg</Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.boxes')}>{fmtNum(shipment.box_count)}</Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.pallets')}>{fmtNum(shipment.pallet_count)}</Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.price_per_kg')}>
              {shipment.price_per_kg != null ? `$${shipment.price_per_kg}` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.total_usd')}>
              {shipment.total_amount_usd != null ? `$${fmtNum(shipment.total_amount_usd)}` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={t('shipment_detail.notes')} span={3}>
              {shipment.notes ?? '—'}
            </Descriptions.Item>
          </Descriptions>

          {shipment.firm_splits.length > 0 && (
            <>
              <Title level={5} style={{ marginBottom: 8 }}>{t('shipment_detail.firm_splits')}</Title>
              <Table<IFirmSplit>
                rowKey="export_firm_id"
                dataSource={shipment.firm_splits}
                columns={firmSplitColumns}
                pagination={false}
                size="small"
                scroll={{ x: 480 }}
              />
            </>
          )}

          {shipment.block_sources.length > 0 && (
            <>
              <Title level={5} style={{ marginBottom: 8 }}>{t('shipment_detail.block_sources')}</Title>
              <Table<IBlockSource>
                rowKey="block_code"
                dataSource={shipment.block_sources}
                columns={blockColumns}
                pagination={false}
                size="small"
                scroll={{ x: 400 }}
              />
            </>
          )}
        </Space>
      ),
    },
    {
      key: 'logistics',
      label: t('shipment_detail.tab_logistics'),
      children: (
        <Descriptions bordered column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label={t('shipment_detail.vehicle_condition')}>
            {shipment.vehicle_condition ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('shipment_detail.condition_note')}>
            {shipment.vehicle_condition_note ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('shipment_detail.route_note')} span={2}>
            {shipment.route_note ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('shipment_detail.loading_started')}>{fmt(shipment.loading_started_at)}</Descriptions.Item>
          <Descriptions.Item label={t('shipment_detail.customs_entry')}>{fmt(shipment.customs_entry_at)}</Descriptions.Item>
          <Descriptions.Item label={t('shipment_detail.customs_exit')}>{fmt(shipment.customs_exit_at)}</Descriptions.Item>
          <Descriptions.Item label={t('shipment_detail.departed')}>{fmt(shipment.departed_at)}</Descriptions.Item>
          <Descriptions.Item label={t('shipment_detail.border_crossed')}>{fmt(shipment.border_crossed_at)}</Descriptions.Item>
          <Descriptions.Item label={t('shipment_detail.arrived')}>{fmt(shipment.arrived_at)}</Descriptions.Item>
          <Descriptions.Item label={t('shipment_detail.sale_started')}>{fmt(shipment.sale_started_at)}</Descriptions.Item>
          <Descriptions.Item label={t('shipment_detail.sale_ended')}>{fmt(shipment.sale_ended_at)}</Descriptions.Item>
        </Descriptions>
      ),
    },
    {
      key: 'quality',
      label: t('shipment_detail.tab_quality'),
      children: (() => {
        const canEditQuality = user?.role === 'export_manager' || user?.role === 'document_team' || user?.role === 'director';
        const q: IShipmentQuality = shipment.quality ?? {
          azyk_maglumatnama: false,
          suriji_gozukdiriji: false,
          hil_sertifikaty: false,
          kalibrowka_analiz: false,
        };
        const fields: (keyof IShipmentQuality)[] = [
          'azyk_maglumatnama',
          'suriji_gozukdiriji',
          'hil_sertifikaty',
          'kalibrowka_analiz',
        ];
        return (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Title level={5} style={{ marginBottom: 0 }}>
              {t('quality.title')}
            </Typography.Title>
            {fields.map((field) => (
              <Checkbox
                key={field}
                checked={q[field]}
                disabled={!canEditQuality || qualityMutation.isPending}
                onChange={(e) =>
                  qualityMutation.mutate({ field, checked: e.target.checked })
                }
              >
                {t(`quality.${field}`)}
              </Checkbox>
            ))}
          </Space>
        );
      })(),
    },
    {
      key: 'comments',
      label: t('shipment_detail.tab_comments', { count: shipment.comments.length }),
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          {shipment.comments.length === 0 ? (
            <Text type="secondary">{t('shipment_detail.no_comments')}</Text>
          ) : (
            shipment.comments.map((c: IShipmentComment) => (
              <div
                key={c.id}
                style={{ background: '#fafafa', borderRadius: 6, padding: '10px 14px', border: '1px solid #f0f0f0' }}
              >
                <Space>
                  <Text strong>{c.user_name}</Text>
                  <Tag>{c.role}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>{fmt(c.created_at)}</Text>
                </Space>
                <div style={{ marginTop: 4 }}>{c.content}</div>
              </div>
            ))
          )}
          <CommentComposer shipmentId={shipment.id} />
        </Space>
      ),
    },
    {
      key: 'history',
      label: t('shipment_detail.tab_history', { count: shipment.status_log.length }),
      children: (
        <Timeline
          items={shipment.status_log.map((entry: IStatusLogEntry, i: number) => ({
            key: i,
            children: (
              <div>
                <Space>
                  <StatusTag statusDisplay={entry.status_display} />
                  <Text type="secondary" style={{ fontSize: 12 }}>{fmt(entry.changed_at)}</Text>
                  <Text type="secondary">{t('shipment_detail.history_by', { name: entry.changed_by_name })}</Text>
                </Space>
                {entry.comment && <div style={{ marginTop: 4, color: '#595959' }}>{entry.comment}</div>}
              </div>
            ),
          }))}
        />
      ),
    },
    {
      key: 'sales_report',
      label: t('sales_report.tab'),
      children: (() => {
        const isAvailable =
          shipment.status_code === 'hasabat' || shipment.status_code === 'tamamlandy';

        if (!isAvailable) {
          return (
            <Text type="secondary" style={{ display: 'block', padding: '24px 0' }}>
              {t('sales_report.only_at_hasabat')}
            </Text>
          );
        }

        const canEdit =
          user?.role === 'sales_rep' ||
          user?.role === 'export_manager' ||
          user?.role === 'director';

        const report = shipment.sales_report;

        const colStyle = {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0 24px',
        } as const;

        return (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {report ? (
              <Descriptions
                bordered
                column={{ xs: 1, sm: 2 }}
                size="small"
                title={null}
              >
                <Descriptions.Item label={t('sales_report.price_per_kg')}>
                  {fmtDecimal(report.price_per_kg)}
                </Descriptions.Item>
                <Descriptions.Item label={t('sales_report.total_usd')}>
                  {fmtDecimal(report.total_usd)}
                </Descriptions.Item>
                <Descriptions.Item label={t('sales_report.weight_sold')}>
                  {fmtDecimal(report.weight_sold_kg)}
                </Descriptions.Item>
                <Descriptions.Item label={t('sales_report.weight_rejected')}>
                  {fmtDecimal(report.weight_rejected_kg)}
                </Descriptions.Item>
                <Descriptions.Item label={t('sales_report.transport_cost')}>
                  {fmtDecimal(report.transport_cost_usd)}
                </Descriptions.Item>
                <Descriptions.Item label={t('sales_report.market_fee')}>
                  {fmtDecimal(report.market_fee_usd)}
                </Descriptions.Item>
                <Descriptions.Item label={t('sales_report.other_expenses')}>
                  {fmtDecimal(report.other_expenses_usd)}
                </Descriptions.Item>
                <Descriptions.Item label={t('sales_report.notes')} span={2}>
                  {report.notes ?? '—'}
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Text type="secondary">{t('sales_report.empty')}</Text>
            )}

            {canEdit && (
              <Form
                form={salesReportForm}
                layout="vertical"
                initialValues={{
                  price_per_kg: report?.price_per_kg ?? undefined,
                  total_usd: report?.total_usd ?? undefined,
                  weight_sold_kg: report?.weight_sold_kg ?? undefined,
                  weight_rejected_kg: report?.weight_rejected_kg ?? undefined,
                  transport_cost_usd: report?.transport_cost_usd ?? undefined,
                  market_fee_usd: report?.market_fee_usd ?? undefined,
                  other_expenses_usd: report?.other_expenses_usd ?? undefined,
                  notes: report?.notes ?? undefined,
                }}
                onFinish={(values) => salesReportMutation.mutate(values)}
              >
                <div style={colStyle}>
                  <Form.Item name="price_per_kg" label={t('sales_report.price_per_kg')}>
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} stringMode />
                  </Form.Item>
                  <Form.Item name="total_usd" label={t('sales_report.total_usd')}>
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} stringMode />
                  </Form.Item>
                  <Form.Item name="weight_sold_kg" label={t('sales_report.weight_sold')}>
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} stringMode />
                  </Form.Item>
                  <Form.Item name="weight_rejected_kg" label={t('sales_report.weight_rejected')}>
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} stringMode />
                  </Form.Item>
                  <Form.Item name="transport_cost_usd" label={t('sales_report.transport_cost')}>
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} stringMode />
                  </Form.Item>
                  <Form.Item name="market_fee_usd" label={t('sales_report.market_fee')}>
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} stringMode />
                  </Form.Item>
                  <Form.Item name="other_expenses_usd" label={t('sales_report.other_expenses')}>
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} stringMode />
                  </Form.Item>
                </div>
                <Form.Item name="notes" label={t('sales_report.notes')}>
                  <Input.TextArea rows={3} />
                </Form.Item>
                <Form.Item>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={salesReportMutation.isPending}
                  >
                    {t('sales_report.submit')}
                  </Button>
                </Form.Item>
              </Form>
            )}
          </Space>
        );
      })(),
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/export/shipments')} />
        <Title level={4} style={{ margin: 0 }}>
          {shipment.cargo_code}
        </Title>
        <StatusTag statusDisplay={shipment.status_display} />
        {shipment.allowed_transitions && shipment.allowed_transitions.length > 0 && (
          <div style={{ marginLeft: 'auto' }}>
            <TransitionButton
              shipmentId={shipment.id}
              allowedTransitions={shipment.allowed_transitions}
            />
          </div>
        )}
      </div>

      <Tabs items={tabItems} defaultActiveKey="overview" />
    </div>
  );
}
