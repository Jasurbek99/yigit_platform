import { Card, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { SalesReportForm } from '@/pages/export/ShipmentDetailHelpers';
import { fmtNum } from '@/pages/export/ShipmentDetailHelpers.helpers';
import { MIN_SALES_REPORT_STEP } from '@/components/salesReport/salesReportUtils';
import type { TableColumnsType } from 'antd';
import type { IFirmSplit, IShipmentDetail } from '@/types';

const { Text, Title } = Typography;

interface IShipmentSaleSectionProps {
  shipment: IShipmentDetail;
  missingKeys: Set<string>;
  readOnly: boolean;
  canEditSalesReport: boolean;
}

/**
 * Full-width "Sale & Finance" section: the editable finance fields, the
 * per-firm split table and the sales report form.
 *
 * The report is visible to every role once the shipment has departed
 * (step >= MIN_SALES_REPORT_STEP) — system status lags the real sale, so
 * gating on "sold" would hide reports for trucks that have already sold.
 */
export function ShipmentSaleSection({
  shipment,
  missingKeys,
  readOnly,
  canEditSalesReport,
}: IShipmentSaleSectionProps) {
  const { t } = useTranslation();

  const firmSplitColumns: TableColumnsType<IFirmSplit> = [
    { title: t('shipment_detail.firm_splits_col_firm'), dataIndex: 'export_firm_name' },
    { title: t('shipment_detail.weight_net'), dataIndex: 'weight_kg', render: (_, r) => fmtNum(r.weight_kg) },
    { title: t('shipment_detail.total_usd'), dataIndex: 'amount_usd', render: (_, r) => fmtNum(r.amount_usd) },
    { title: t('shipment_detail.firm_splits_col_invoice'), dataIndex: 'invoice_number', render: (_, r) => r.invoice_number ?? '—' },
  ];

  const isReportAvailable = shipment.status_step >= MIN_SALES_REPORT_STEP;

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={
        <span style={{ fontWeight: 600, fontSize: 13 }}>{t('shipment.detail.stage.sale')}</span>
      }
    >
      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="finance"
        missingKeys={missingKeys}
        readOnly={readOnly}
      />

      {shipment.firm_splits.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Title level={5} style={{ marginBottom: 8 }}>{t('shipment_detail.firm_splits')}</Title>
          <Table<IFirmSplit>
            dataSource={shipment.firm_splits}
            columns={firmSplitColumns}
            rowKey="export_firm_id"
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {isReportAvailable ? (
          <>
            {!shipment.sales_report && !canEditSalesReport && (
              <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                {t('sales_report.empty')}
              </Text>
            )}
            <SalesReportForm
              shipmentId={String(shipment.id)}
              report={shipment.sales_report}
              canEdit={canEditSalesReport}
            />
          </>
        ) : (
          <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>
            {t('sales_report.only_at_hasabat')}
          </Text>
        )}
      </div>
    </Card>
  );
}
