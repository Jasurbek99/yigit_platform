import { Card, Skeleton, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useTranslation } from 'react-i18next';
import { useQuotaUsageRecords } from '@/hooks/useQuotaUsage';
import { fmtDate } from '@/pages/export/ShipmentDetailHelpers.helpers';
import type { IQuotaUsageRecord, IShipmentDetail } from '@/types';

interface IShipmentQuotaCardProps {
  shipment: IShipmentDetail;
}

const kg = (value: number): string =>
  `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} kg`;

/**
 * How much export quota this truck consumed, per firm.
 *
 * The mirror of the shipment column in the quota usage list: quota is spent by
 * trucks, so the shipment is where operators ask "did this cost quota, whose,
 * and has it been approved yet?". Rows come from `?shipment=`, which the backend
 * deliberately leaves outside the season scope so a prior-season shipment opened
 * by direct link still shows its own quota.
 */
export function ShipmentQuotaCard({ shipment }: IShipmentQuotaCardProps) {
  const { t } = useTranslation();
  const { data: records = [], isLoading } = useQuotaUsageRecords({ shipment: shipment.id });

  const columns: TableColumnsType<IQuotaUsageRecord> = [
    {
      title: t('shipment_quota.col_firm'),
      dataIndex: 'export_firm_name',
      render: (_: unknown, r: IQuotaUsageRecord) => (
        <Typography.Text strong>{r.export_firm_name}</Typography.Text>
      ),
    },
    {
      title: t('shipment_quota.col_kg'),
      dataIndex: 'kg_used',
      align: 'right',
      width: 140,
      render: (_: unknown, r: IQuotaUsageRecord) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {kg(Number(r.kg_used))}
        </span>
      ),
    },
    {
      title: t('shipment_quota.col_date'),
      dataIndex: 'usage_date',
      width: 110,
      responsive: ['md'],
      render: (v: string) => fmtDate(v),
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={
        <span style={{ fontWeight: 600, fontSize: 13 }}>{t('shipment_quota.section_title')}</span>
      }
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : records.length > 0 ? (
        <Table<IQuotaUsageRecord>
          rowKey="id"
          dataSource={records}
          size="small"
          pagination={false}
          columns={columns}
          footer={() => (
            <div style={{ textAlign: 'right', fontWeight: 700, padding: '4px 0' }}>
              {t('shipment_quota.total_label')}:{' '}
              {kg(records.reduce((sum, r) => sum + Number(r.kg_used), 0))}
            </div>
          )}
        />
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {t('shipment_quota.no_records')}
        </Typography.Text>
      )}
    </Card>
  );
}
