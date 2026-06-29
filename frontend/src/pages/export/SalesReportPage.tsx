/**
 * SalesReportPage — full-page, Excel-like sales report at /export/sales-reports/:shipmentId
 *
 * Splits the report into two tabs:
 *   Sale tab     — sales rep: line items + pre-seeded expenses + summary
 *   Processing   — export manager: Kurs, weights, per-block loss, USD totals
 *
 * Both tabs edit one SalesReport record. State is lifted here; one Save button
 * persists everything. Both tab panes stay mounted (no destroyInactiveTabPane)
 * so Form.Items from both tabs register at validateFields() time.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Input,
  Spin,
  Tabs,
  Typography,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { useCountries } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useSaveSalesReport } from '@/hooks/useSalesReport';
import { StatusTag } from '@/components/StatusTag';
import { MIN_SALES_REPORT_STEP } from '@/components/salesReport/salesReportUtils';
import type { ILineRow, IExpenseRow } from '@/components/salesReport/salesReportUtils';
import { SaleTab } from '@/components/salesReport/SaleTab';
import { ProcessingTab } from '@/components/salesReport/ProcessingTab';
import type {
  ISalesReportExpenseInput,
  ISalesReportLineItemInput,
  ISalesReportPayload,
} from '@/types';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;

// ─── Payload builder ──────────────────────────────────────────────────────────

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
    .filter((r) => r.category !== null && r.amount_local !== null && r.amount_local > 0)
    .map((r) => ({
      category: r.category as number,
      label_raw: r.label_raw || null,
      amount_local: r.amount_local!,
    }));

  // weight_rejected_kg is derived (loaded − sold); the form renders it as a display-only
  // InputNumber with no `name`, so it is never returned by validateFields(). Compute it here.
  const loadedKg = (vals['weight_loaded_kg'] as number | null | undefined) ?? null;
  const soldKg = (vals['weight_sold_kg'] as number | null | undefined) ?? null;
  const rejectedKg =
    loadedKg != null && soldKg != null ? Math.max(0, loadedKg - soldKg) : null;

  // Currency is pre-filled in the form from the destination country (KZ→KZT, RU→RUB) and is
  // editable, so always send the form value. The backend still defaults from country if absent.
  const currency = (vals['currency'] as string) || 'KZT';

  return {
    currency,
    exchange_rate: (vals['exchange_rate'] as number | null | undefined) ?? null,
    weight_loaded_kg: loadedKg,
    weight_sold_kg: soldKg,
    weight_rejected_kg: rejectedKg,
    notes: (vals['notes'] as string | null | undefined) ?? null,
    line_items: lineItems,
    expenses: expenseItems,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalesReportPage(): React.ReactElement {
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data: detail, isLoading, isError } = useShipmentDetail(shipmentId);
  const { data: categories = [] } = useExpenseCategories();
  const { data: countries = [], isLoading: countriesLoading } = useCountries();
  const mutation = useSaveSalesReport(shipmentId ?? '');

  const [form] = Form.useForm();

  const canEdit =
    (user?.role === 'sales_rep' ||
      user?.role === 'export_manager' ||
      user?.role === 'director' ||
      user?.role === 'admin' ||
      user?.is_superuser === true) &&
    (detail?.status_step ?? 0) >= MIN_SALES_REPORT_STEP;

  // ─── Line items state ─────────────────────────────────────────────────────
  const [lines, setLines] = useState<ILineRow[]>([]);
  const [nextLineKey, setNextLineKey] = useState(0);

  // ─── Expense rows — seeded from admin category template ───────────────────
  const [expenses, setExpenses] = useState<IExpenseRow[]>([]);

  // Tracks which shipment id has already been seeded so we don't overwrite
  // unsaved edits when categories.length or countries settle after first load.
  const seededShipmentIdRef = useRef<number | null>(null);

  // Seed state once per shipment when shipment, categories, and countries are ready.
  // Switching to a different shipment (different :shipmentId → different detail.id)
  // clears the ref and re-seeds for the new shipment.
  useEffect(() => {
    // Wait until countries have settled so we apply the correct country currency.
    if (!detail || categories.length === 0 || countriesLoading) return;
    // Skip if we've already seeded this shipment (avoids clobbering unsaved edits).
    if (seededShipmentIdRef.current === detail.id) return;
    seededShipmentIdRef.current = detail.id;

    // Destination-country currency (KZ→KZT, RU→RUB); fallback to 'KZT'.
    const countryCurrency =
      countries.find((c) => c.id === detail.country)?.currency ?? null;

    // Line items from saved report; clear when the new shipment has none.
    if (detail.sales_report?.line_items?.length) {
      const rows: ILineRow[] = detail.sales_report.line_items.map((li, i) => ({
        _key: i,
        product_name: li.product_name ?? '',
        quantity_kg: li.quantity_kg ? Number(li.quantity_kg) : null,
        price_local: li.price_local ? Number(li.price_local) : null,
      }));
      setLines(rows);
      setNextLineKey(rows.length);
    } else {
      setLines([]);
      setNextLineKey(0);
    }

    // Map saved expense amounts by category PK
    const savedMap = new Map<number, { amount_local: number; label_raw: string }>();
    for (const ex of detail.sales_report?.expenses ?? []) {
      savedMap.set(ex.category, {
        amount_local: ex.amount_local ? Number(ex.amount_local) : 0,
        label_raw: ex.label_raw ?? '',
      });
    }

    // One row per active template category; populate saved amounts
    const seededRows: IExpenseRow[] = categories.map((cat, i) => ({
      _key: i,
      category: cat.id,
      category_code: cat.code,
      label_raw: savedMap.get(cat.id)?.label_raw ?? '',
      amount_local: savedMap.get(cat.id)?.amount_local ?? null,
    }));
    setExpenses(seededRows);

    // Seed form fields
    const report = detail.sales_report;
    const blockTotal = (detail.block_sources ?? []).reduce((s, b) => s + b.weight_kg, 0);

    form.setFieldsValue({
      currency: report?.currency ?? countryCurrency ?? 'KZT',
      exchange_rate: report?.exchange_rate ? Number(report.exchange_rate) : null,
      weight_loaded_kg:
        report?.weight_loaded_kg
          ? Number(report.weight_loaded_kg)
          : blockTotal > 0
          ? blockTotal
          : null,
      weight_sold_kg: report?.weight_sold_kg ? Number(report.weight_sold_kg) : null,
      weight_rejected_kg: report?.weight_rejected_kg ? Number(report.weight_rejected_kg) : null,
      notes: report?.notes ?? null,
    });
  // Run when shipment id, category list, or countries loading state changes.
  // The ref prevents re-seeding the same shipment; switching shipments clears the ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, categories.length, countriesLoading]);

  // ─── Derived totals passed to both tabs ───────────────────────────────────
  const grossSalesLocal = useMemo(
    () => lines.reduce((a, r) => a + (r.quantity_kg ?? 0) * (r.price_local ?? 0), 0),
    [lines],
  );
  const totalExpensesLocal = useMemo(
    () => expenses.reduce((a, r) => a + (r.amount_local ?? 0), 0),
    [expenses],
  );

  const kurs = Form.useWatch<number | null | undefined>('exchange_rate', form);
  const exchangeRate = kurs != null && kurs > 0 ? kurs : null;

  // ─── Line handlers ────────────────────────────────────────────────────────
  const handleLineChange = (key: number, field: keyof Omit<ILineRow, '_key'>, v: unknown) =>
    setLines((p) => p.map((r) => (r._key === key ? { ...r, [field]: v } : r)));

  const handleAddLine = () => {
    setLines((p) => [
      ...p,
      { _key: nextLineKey, product_name: '', quantity_kg: null, price_local: null },
    ]);
    setNextLineKey((k) => k + 1);
  };

  const handleRemoveLine = (key: number) =>
    setLines((p) => p.filter((r) => r._key !== key));

  // ─── Expense handler ──────────────────────────────────────────────────────
  const handleExpenseChange = (key: number, field: keyof Omit<IExpenseRow, '_key'>, v: unknown) =>
    setExpenses((p) => p.map((r) => (r._key === key ? { ...r, [field]: v } : r)));

  // ─── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    let vals: Record<string, unknown>;
    try {
      vals = await form.validateFields();
    } catch {
      return;
    }
    mutation.mutate(buildPayload(vals, lines, expenses), {
      onSuccess: () => toast.success(t('sales_report.toast_success')),
      onError: () => toast.error(t('sales_report.toast_error')),
    });
  };

  // ─── Loading / error ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isError || detail == null) {
    return (
      <Alert
        type="error"
        message={t('shipment_detail.error_load')}
        style={{ margin: 24 }}
        showIcon
      />
    );
  }

  // ─── Tabs ─────────────────────────────────────────────────────────────────

  // forceRender: true on both panes — REQUIRED so all Form.Items register regardless of active tab.
  // Without this, the inactive tab's form fields (exchange_rate, weight_loaded_kg, etc.) are not
  // mounted at validateFields() time, causing Save to send null and overwrite prior export-manager data.
  const tabItems = [
    {
      key: 'sale',
      label: t('sales_report.tab_sale'),
      forceRender: true,
      children: (
        <SaleTab
          lines={lines}
          expenses={expenses}
          canEdit={canEdit}
          exchangeRate={exchangeRate}
          onLineChange={handleLineChange}
          onAddLine={handleAddLine}
          onRemoveLine={handleRemoveLine}
          onExpenseChange={handleExpenseChange}
        />
      ),
    },
    {
      key: 'processing',
      label: t('sales_report.tab_processing'),
      forceRender: true,
      children: (
        <ProcessingTab
          blockSources={detail.block_sources ?? []}
          lines={lines}
          canEdit={canEdit}
          grossSalesLocal={grossSalesLocal}
          totalExpensesLocal={totalExpensesLocal}
        />
      ),
    },
  ];

  return (
    <div>
      {/* Back button */}
      <div style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => navigate(-1)} />
      </div>

      {/* Title + status tag */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Title level={4} style={{ margin: 0, color: COLORS.textDark }}>
          {t('sales_report.page_title')} — {detail.shipment_code}
        </Title>
        {detail.status_display && <StatusTag statusDisplay={detail.status_display} />}
      </div>

      {/* Context Descriptions */}
      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, sm: 2, md: 3 }}
        style={{ background: COLORS.white, marginBottom: 24 }}
      >
        <Descriptions.Item label={t('shipments.customer')}>
          {detail.customer_name ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('shipments.country')}>
          {detail.country_name ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('shipments.status')}>
          {detail.status_display ?? '—'}
        </Descriptions.Item>
      </Descriptions>

      {/* Single Form wrapping both tabs — both tab panes STAY mounted */}
      <Form form={form} layout="vertical" size="small">
        {/* Currency field — above the tabs, applies to both */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Form.Item
              name="currency"
              label={t('sales_report.currency')}
              style={{ marginBottom: 0 }}
            >
              <Input disabled={!canEdit} maxLength={10} style={{ width: 90 }} placeholder="KZT" />
            </Form.Item>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('sales_report.currency_hint')}
            </Text>
          </div>
        </Card>

        {/* Tabs — destroyInactiveTabPane intentionally NOT set so all Form.Items stay registered */}
        <Tabs items={tabItems} />
      </Form>

      <Divider style={{ margin: '12px 0' }} />

      {canEdit && (
        <div style={{ paddingBottom: 24 }}>
          <Button
            type="primary"
            loading={mutation.isPending}
            onClick={() => void handleSave()}
          >
            {t('sales_report.submit')}
          </Button>
        </div>
      )}

      {!canEdit && (
        <Alert
          type="info"
          message={t('sales_report.only_at_hasabat')}
          style={{ marginTop: 8 }}
          showIcon
        />
      )}
    </div>
  );
}
