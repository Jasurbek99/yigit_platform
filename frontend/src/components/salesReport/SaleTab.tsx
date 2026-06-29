import React from 'react';
import { Card, Divider, Form, Input } from 'antd';
import { useTranslation } from 'react-i18next';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import { LineItemsTable } from './LineItemsTable';
import { FixedExpensesTable } from './FixedExpensesTable';
import { SummaryRow } from './SummaryRow';
import { fmtLocal, fmtUsd } from './salesReportUtils';
import type { ILineRow, IExpenseRow } from './salesReportUtils';

interface ISaleTabProps {
  readonly lines: ILineRow[];
  readonly expenses: IExpenseRow[];
  readonly canEdit: boolean;
  readonly exchangeRate: number | null;
  readonly onLineChange: (key: number, field: keyof Omit<ILineRow, '_key'>, v: unknown) => void;
  readonly onAddLine: () => void;
  readonly onRemoveLine: (key: number) => void;
  readonly onExpenseChange: (key: number, field: keyof Omit<IExpenseRow, '_key'>, v: unknown) => void;
}

export function SaleTab({
  lines,
  expenses,
  canEdit,
  exchangeRate,
  onLineChange,
  onAddLine,
  onRemoveLine,
  onExpenseChange,
}: ISaleTabProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { data: categories = [] } = useExpenseCategories();

  const grossSalesLocal = lines.reduce(
    (a, r) => a + (r.quantity_kg ?? 0) * (r.price_local ?? 0),
    0,
  );
  const totalExpensesLocal = expenses.reduce((a, r) => a + (r.amount_local ?? 0), 0);
  const netLocal = grossSalesLocal - totalExpensesLocal;

  return (
    <div style={{ paddingTop: 8 }}>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Form.Item name="notes" label={t('sales_report.notes')} style={{ marginBottom: 0 }}>
          <Input.TextArea rows={2} disabled={!canEdit} />
        </Form.Item>
      </Card>

      <Card size="small" title={t('sales_report.section_lines')} style={{ marginBottom: 16 }}>
        <LineItemsTable
          rows={lines}
          canEdit={canEdit}
          onRowChange={onLineChange}
          onAddRow={onAddLine}
          onRemoveRow={onRemoveLine}
        />
      </Card>

      <Card size="small" title={t('sales_report.section_expenses')} style={{ marginBottom: 16 }}>
        <FixedExpensesTable
          rows={expenses}
          categories={categories}
          canEdit={canEdit}
          lang={i18n.language as 'tk' | 'ru' | 'en'}
          onRowChange={onExpenseChange}
        />
      </Card>

      <Card size="small" title={t('sales_report.summary')}>
        <div style={{ maxWidth: 360, marginLeft: 'auto' }}>
          <SummaryRow label={t('sales_report.gross_sales_local')} value={fmtLocal(grossSalesLocal)} />
          <SummaryRow label={t('sales_report.total_expenses_local')} value={fmtLocal(totalExpensesLocal)} />
          <SummaryRow label={t('sales_report.net_income_local')} value={fmtLocal(netLocal)} highlight />
          {exchangeRate != null && exchangeRate > 0 && (
            <>
              <Divider style={{ margin: '8px 0' }} />
              <SummaryRow
                label={t('sales_report.gross_sales_usd')}
                value={`$${fmtUsd(grossSalesLocal / exchangeRate)}`}
              />
              <SummaryRow
                label={t('sales_report.total_expenses_usd')}
                value={`$${fmtUsd(totalExpensesLocal / exchangeRate)}`}
              />
              <SummaryRow
                label={t('sales_report.net_income_usd')}
                value={`$${fmtUsd(netLocal / exchangeRate)}`}
                highlight
              />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
