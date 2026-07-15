/**
 * ProcessingTab — export manager view in the SalesReportPage.
 *
 * Fields: Kurs (exchange_rate), loaded weight (default from block_sources),
 * sold weight (default from sale line qty sum), rejected = loaded − sold (derived),
 * per-block table with proportional loss share, and derived USD totals.
 */
import React, { useMemo } from 'react';
import { Card, Divider, Form, InputNumber } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IBlockSource } from '@/types';
import { COLORS } from '@/constants/styles';
import { fmtLocal, fmtUsd } from './salesReportUtils';
import { SummaryRow } from './SummaryRow';
import { BlockLossTable } from './BlockLossTable';
import { BlockBreakdownCard } from '@/components/BlockBreakdownCard';
import type { ILineRow } from './salesReportUtils';

interface IProcessingTabProps {
  readonly shipmentId: number;
  readonly blockSources: IBlockSource[];
  readonly lines: ILineRow[];
  readonly canEdit: boolean;
  // totals coming from Sale tab (for USD derivation)
  readonly grossSalesLocal: number;
  readonly totalExpensesLocal: number;
}

export function ProcessingTab({
  shipmentId,
  blockSources,
  lines,
  canEdit,
  grossSalesLocal,
  totalExpensesLocal,
}: IProcessingTabProps): React.ReactElement {
  const { t } = useTranslation();

  // Watch form fields to derive values in real-time
  const weightLoaded = Form.useWatch<number | null | undefined>('weight_loaded_kg');
  const weightSold = Form.useWatch<number | null | undefined>('weight_sold_kg');
  const kurs = Form.useWatch<number | null | undefined>('exchange_rate');

  const loadedKg = weightLoaded ?? 0;
  const soldKg = weightSold ?? 0;
  const rejectedKg = loadedKg - soldKg;
  const exchangeRate = kurs && kurs > 0 ? kurs : null;
  const netLocal = grossSalesLocal - totalExpensesLocal;

  const lineSoldTotal = useMemo(
    () => lines.reduce((a, r) => a + (r.quantity_kg ?? 0), 0),
    [lines],
  );

  return (
    <div style={{ paddingTop: 8 }}>
      <Card size="small" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '0 16px',
          }}
        >
          <Form.Item name="exchange_rate" label={t('sales_report.exchange_rate')}>
            <InputNumber min={0} precision={4} style={{ width: '100%' }} disabled={!canEdit} />
          </Form.Item>
          <Form.Item name="weight_loaded_kg" label={t('sales_report.weight_loaded_kg')}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
          </Form.Item>
          <Form.Item name="weight_sold_kg" label={t('sales_report.weight_sold')}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!canEdit} />
          </Form.Item>
          <Form.Item label={t('sales_report.processing_rejected')}>
            <InputNumber
              value={rejectedKg}
              min={0}
              precision={2}
              style={{ width: '100%', background: COLORS.bgLayout }}
              disabled
            />
          </Form.Item>
        </div>
        {lineSoldTotal > 0 && (soldKg === 0 || soldKg == null) && (
          <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 4 }}>
            {t('sales_report.processing_line_sum_hint', { kg: fmtLocal(lineSoldTotal) })}
          </div>
        )}
      </Card>

      {blockSources.length > 0 && (
        <Card
          size="small"
          title={t('sales_report.processing_block_table')}
          style={{ marginBottom: 16 }}
        >
          <BlockLossTable blockSources={blockSources} rejectedKg={rejectedKg} />
        </Card>
      )}

      {/* Per (block × variety) loaded-weight breakdown, auto-filled from the
          weightmaster pallet data — the finansist verifies, never retypes. */}
      <BlockBreakdownCard shipmentId={shipmentId} />

      {exchangeRate != null && (
        <Card size="small" title={t('sales_report.summary')}>
          <div style={{ maxWidth: 360, marginLeft: 'auto' }}>
            <SummaryRow
              label={t('sales_report.gross_sales_usd')}
              value={`$${fmtUsd(grossSalesLocal / exchangeRate)}`}
            />
            <SummaryRow
              label={t('sales_report.total_expenses_usd')}
              value={`$${fmtUsd(totalExpensesLocal / exchangeRate)}`}
            />
            <Divider style={{ margin: '8px 0' }} />
            <SummaryRow
              label={t('sales_report.net_income_usd')}
              value={`$${fmtUsd(netLocal / exchangeRate)}`}
              highlight
            />
          </div>
        </Card>
      )}
    </div>
  );
}
