import { Link } from 'react-router-dom';
import { Modal, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useTranslation } from 'react-i18next';
import { fmtWeight, weightSuffix, type WeightUnit } from '@/utils/weight';
import { sumKg } from './QuotaUsageGrid.helpers';
import type { IQuotaUsageRecord } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IQuotaUsageCellDetailProps {
  open: boolean;
  onClose: () => void;
  /** Cell heading — the firm's display name. */
  firmName: string;
  /** Cell heading — the date, already formatted for display. */
  dateDisplay: string;
  records: IQuotaUsageRecord[];
  weightUnit: WeightUnit;
}

/**
 * The records behind one grid cell.
 *
 * A (date, firm) cell can hold several usage records — one per truck that firm
 * rode that day. The grid shows their sum; this is where the individual rows and
 * their shipments become reachable.
 */
export function QuotaUsageCellDetail({
  open,
  onClose,
  firmName,
  dateDisplay,
  records,
  weightUnit,
}: IQuotaUsageCellDetailProps) {
  const { t } = useTranslation();

  const columns: TableColumnsType<IQuotaUsageRecord> = [
    {
      title: t('quota_usage.shipment_code'),
      dataIndex: 'shipment_code',
      render: (_: unknown, r: IQuotaUsageRecord) =>
        r.shipment != null && r.shipment_code ? (
          <Link to={`/shipments/${r.shipment}`}>{r.shipment_code}</Link>
        ) : (
          <Tag>{t('quota_usage.source_manual')}</Tag>
        ),
    },
    {
      title: `${t('quota_usage.kg_used')} (${weightSuffix(weightUnit)})`,
      dataIndex: 'kg_used',
      align: 'right',
      width: 130,
      render: (_: unknown, r: IQuotaUsageRecord) => fmtWeight(r.kg_used, weightUnit),
    },
    {
      title: t('quota_usage.created_by'),
      dataIndex: 'created_by_name',
      width: 130,
      render: (_: unknown, r: IQuotaUsageRecord) => r.created_by_name ?? '—',
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      title={t('quota_usage.cell_detail_title', { firm: firmName, date: dateDisplay })}
    >
      <Table<IQuotaUsageRecord>
        dataSource={records}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={false}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <Text strong>{t('quota_usage.grid_total')}</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <Text strong style={{ color: COLORS.primary }}>
                {fmtWeight(sumKg(records), weightUnit)}
              </Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} />
          </Table.Summary.Row>
        )}
      />
    </Modal>
  );
}
