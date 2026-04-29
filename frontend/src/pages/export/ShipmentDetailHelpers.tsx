import { Button, Form, Input, InputNumber } from 'antd';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import api from '@/services/api';
import type { ISalesReport } from '@/types';

// ─── Formatters ─────────────────────────────────────────────────────────────

export function fmt(val: string | null | undefined): string {
  if (!val) return '—';
  return dayjs(val).format('DD.MM.YYYY HH:mm');
}

export function fmtDate(val: string | null | undefined): string {
  if (!val) return '—';
  return dayjs(val).format('DD.MM.YYYY');
}

export function fmtNum(val: number | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}

// ─── InfoRow ────────────────────────────────────────────────────────────────

interface IInfoRowProps {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  mono?: boolean;
}

export function InfoRow({ label, value, bold, mono }: IInfoRowProps) {
  return (
    <div style={{ display: 'flex', padding: '6px 0' }}>
      <div style={{ width: 160, fontSize: 13, color: '#8c8c8c', flexShrink: 0 }}>{label}</div>
      <div style={{
        fontSize: 13,
        flex: 1,
        fontWeight: bold ? 600 : undefined,
        fontFamily: mono ? 'monospace' : undefined,
      }}>
        {value}
      </div>
    </div>
  );
}

// ─── SectionBlock ───────────────────────────────────────────────────────────

interface ISectionBlockProps {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function SectionBlock({ title, children, actions }: ISectionBlockProps) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontWeight: 600,
        fontSize: 14,
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        <span>{title}</span>
        {actions && <span>{actions}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── SalesReportForm ────────────────────────────────────────────────────────

interface ISalesReportFormProps {
  shipmentId: string;
  report: ISalesReport | null | undefined;
  canEdit: boolean;
}

export function SalesReportForm({ shipmentId, report, canEdit }: ISalesReportFormProps) {
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
