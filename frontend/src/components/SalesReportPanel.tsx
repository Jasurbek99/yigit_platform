import { useMemo, useState } from 'react';
import { Button, Divider, Form, Input, InputNumber, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSaveSalesReport } from '@/hooks/useSalesReport';
import { LineItemsTable } from './salesReport/LineItemsTable';
import { ExpensesTable } from './salesReport/ExpensesTable';
import { fmtLocal, fmtUsd } from './salesReport/salesReportUtils';
import type { ILineRow, IExpenseRow } from './salesReport/salesReportUtils';
import type {
  ISalesReport,
  ISalesReportExpenseInput,
  ISalesReportLineItemInput,
  ISalesReportPayload,
} from '@/types';

// SalesReportPanel is used by ShipmentDetail (via SalesReportForm alias in ShipmentDetailHelpers).
// The new full-page SalesReportPage replaces the SalesReportDrawer flow; this panel stays for detail.

const { Text } = Typography;

interface ISalesReportPanelProps {
  readonly shipmentId: string;
  readonly report: ISalesReport | null | undefined;
  readonly canEdit: boolean;
  readonly onSaved?: () => void;
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <Text style={{ fontSize: 13, color: highlight ? undefined : '#595959' }}>{label}</Text>
      <Text strong={highlight} style={{ fontSize: 13 }}>{value}</Text>
    </div>
  );
}

function buildPayload(
  vals: Record<string, unknown>,
  lines: ILineRow[],
  expenses: IExpenseRow[],
): ISalesReportPayload {
  const lineItems: ISalesReportLineItemInput[] = lines
    .filter((r) => r.quantity_kg !== null && r.price_local !== null)
    .map((r, i) => ({
      line_number: i + 1,
      product_name: r.product_name || null,
      quantity_kg: r.quantity_kg!,
      price_local: r.price_local!,
    }));
  const expenseItems: ISalesReportExpenseInput[] = expenses
    .filter((r) => r.category !== null && r.amount_local !== null)
    .map((r) => ({ category: r.category as number, label_raw: r.label_raw || null, amount_local: r.amount_local! }));
  return {
    currency: (vals['currency'] as string) || 'KZT',
    exchange_rate: (vals['exchange_rate'] as number | null | undefined) ?? null,
    weight_loaded_kg: (vals['weight_loaded_kg'] as number | null | undefined) ?? null,
    weight_sold_kg: (vals['weight_sold_kg'] as number | null | undefined) ?? null,
    weight_rejected_kg: (vals['weight_rejected_kg'] as number | null | undefined) ?? null,
    notes: (vals['notes'] as string | null | undefined) ?? null,
    line_items: lineItems,
    expenses: expenseItems,
  };
}

export function SalesReportPanel({ shipmentId, report, canEdit, onSaved }: ISalesReportPanelProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const mutation = useSaveSalesReport(shipmentId);

  const [lines, setLines] = useState<ILineRow[]>(() =>
    report?.line_items?.map((li, i) => ({
      _key: i,
      product_name: li.product_name ?? '',
      quantity_kg: li.quantity_kg ? Number(li.quantity_kg) : null,
      price_local: li.price_local ? Number(li.price_local) : null,
    })) ?? [],
  );
  const [expenses, setExpenses] = useState<IExpenseRow[]>(() =>
    report?.expenses?.map((ex, i) => ({
      _key: i,
      category: ex.category,      // now number PK
      category_code: ex.category_code ?? '',
      label_raw: ex.label_raw ?? '',
      amount_local: ex.amount_local ? Number(ex.amount_local) : null,
    })) ?? [],
  );
  const [nextKey, setNextKey] = useState(
    Math.max((report?.line_items?.length ?? 0), (report?.expenses?.length ?? 0), 1),
  );

  const kurs = Form.useWatch('exchange_rate', form) as number | null | undefined;
  const exchangeRate = kurs && kurs > 0 ? kurs : null;
  const grossSalesLocal = useMemo(() => lines.reduce((a, r) => a + (r.quantity_kg ?? 0) * (r.price_local ?? 0), 0), [lines]);
  const totalExpensesLocal = useMemo(() => expenses.reduce((a, r) => a + (r.amount_local ?? 0), 0), [expenses]);
  const netLocal = grossSalesLocal - totalExpensesLocal;

  const bumpKey = () => setNextKey((k) => k + 1);
  const updateLine = (key: number, field: keyof Omit<ILineRow, '_key'>, v: unknown) =>
    setLines((p) => p.map((r) => (r._key === key ? { ...r, [field]: v } : r)));
  const updateExpense = (key: number, field: keyof Omit<IExpenseRow, '_key'>, v: unknown) =>
    setExpenses((p) => p.map((r) => (r._key === key ? { ...r, [field]: v } : r)));
  const addLine = () => { setLines((p) => [...p, { _key: nextKey, product_name: '', quantity_kg: null, price_local: null }]); bumpKey(); };
  const addExpense = () => { setExpenses((p) => [...p, { _key: nextKey, category: null, category_code: '', label_raw: '', amount_local: null }]); bumpKey(); };
  const removeLine = (key: number) => setLines((p) => p.filter((r) => r._key !== key));
  const removeExpense = (key: number) => setExpenses((p) => p.filter((r) => r._key !== key));

  const handleSave = async () => {
    let vals: Record<string, unknown>;
    try { vals = await form.validateFields(); } catch { return; }
    mutation.mutate(buildPayload(vals, lines, expenses), {
      onSuccess: () => {
        toast.success(t('sales_report.toast_success'));
        onSaved?.();
      },
      onError: () => toast.error(t('sales_report.toast_error')),
    });
  };

  return (
    <div>
      <Form form={form} layout="vertical" size="small"
        initialValues={{
          currency: report?.currency ?? 'KZT',
          exchange_rate: report?.exchange_rate ? Number(report.exchange_rate) : null,
          weight_loaded_kg: report?.weight_loaded_kg ? Number(report.weight_loaded_kg) : null,
          weight_sold_kg: report?.weight_sold_kg ? Number(report.weight_sold_kg) : null,
          weight_rejected_kg: report?.weight_rejected_kg ? Number(report.weight_rejected_kg) : null,
          notes: report?.notes ?? null,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0 16px' }}>
          <Form.Item name="currency" label={t('sales_report.currency')}>
            <Input disabled={!canEdit} maxLength={10} placeholder="KZT" />
          </Form.Item>
          <Form.Item name="exchange_rate" label={t('sales_report.exchange_rate')}>
            <InputNumber min={0} precision={4} style={{ width: '100%' }} disabled={!canEdit} />
          </Form.Item>
          <Form.Item name="weight_loaded_kg" label={t('sales_report.weight_loaded_kg')}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
          </Form.Item>
          <Form.Item name="weight_sold_kg" label={t('sales_report.weight_sold')}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
          </Form.Item>
          <Form.Item name="weight_rejected_kg" label={t('sales_report.weight_rejected')}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
          </Form.Item>
        </div>
        <Form.Item name="notes" label={t('sales_report.notes')}>
          <Input.TextArea rows={2} disabled={!canEdit} />
        </Form.Item>
      </Form>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t('sales_report.section_lines')}</div>
        <LineItemsTable rows={lines} canEdit={canEdit} onRowChange={updateLine} onAddRow={addLine} onRemoveRow={removeLine} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t('sales_report.section_expenses')}</div>
        <ExpensesTable rows={expenses} canEdit={canEdit} onRowChange={updateExpense} onAddRow={addExpense} onRemoveRow={removeExpense} />
      </div>

      <Divider style={{ margin: '12px 0' }} />
      <div style={{ maxWidth: 340 }}>
        <SummaryRow label={t('sales_report.gross_sales_local')} value={fmtLocal(grossSalesLocal)} />
        <SummaryRow label={t('sales_report.total_expenses_local')} value={fmtLocal(totalExpensesLocal)} />
        <SummaryRow label={t('sales_report.net_income_local')} value={fmtLocal(netLocal)} highlight />
        {exchangeRate && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <SummaryRow label={t('sales_report.gross_sales_usd')} value={`$${fmtUsd(grossSalesLocal / exchangeRate)}`} />
            <SummaryRow label={t('sales_report.total_expenses_usd')} value={`$${fmtUsd(totalExpensesLocal / exchangeRate)}`} />
            <SummaryRow label={t('sales_report.net_income_usd')} value={`$${fmtUsd(netLocal / exchangeRate)}`} highlight />
          </>
        )}
      </div>

      {canEdit && (
        <div style={{ marginTop: 16 }}>
          <Space>
            <Button type="primary" loading={mutation.isPending} onClick={() => void handleSave()}>
              {t('sales_report.submit')}
            </Button>
          </Space>
        </div>
      )}
    </div>
  );
}
