import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, DatePicker, Flex, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import { useQuotaUsageRecords } from '@/hooks/useQuotaUsage';
import { fmtWeight, weightSuffix, type WeightUnit } from '@/utils/weight';
import { QuotaUsageFirmRows } from './QuotaUsageFirmRows';
import {
  MANUAL_GROUP_KEY,
  groupRecordsByShipment,
  totalKg,
  type IUsageGroup,
} from './QuotaUsageByShipment.helpers';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IQuotaUsageByShipmentProps {
  weightUnit: WeightUnit;
  productType: string;
}

/**
 * Quota usage grouped by the truck that spent it, firms nested inside.
 *
 * Replaced the date × firm matrix on 2026-08-11: quota is consumed per truck, so
 * the truck is what an operator reconciles against, and the matrix could not show
 * which shipment a number came from at all.
 */
export function QuotaUsageByShipment({ weightUnit, productType }: IQuotaUsageByShipmentProps) {
  const { t } = useTranslation();
  const [selectedMonth, setSelectedMonth] = useState<Dayjs>(dayjs());

  const { data: records = [], isLoading, isError } = useQuotaUsageRecords({
    date_from: selectedMonth.startOf('month').format('YYYY-MM-DD'),
    date_to: selectedMonth.endOf('month').format('YYYY-MM-DD'),
    product_type: productType,
  });

  const groups = useMemo(() => groupRecordsByShipment(records), [records]);

  const columns: TableColumnsType<IUsageGroup> = [
    {
      title: t('quota_usage.shipment_code'),
      dataIndex: 'shipmentCode',
      render: (_: unknown, group: IUsageGroup) =>
        group.key === MANUAL_GROUP_KEY ? (
          <Tag>{t('quota_usage.group_manual')}</Tag>
        ) : (
          <Link to={`/shipments/${group.shipmentId}`}>
            <Text strong>{group.shipmentCode ?? `#${group.shipmentId}`}</Text>
          </Link>
        ),
    },
    {
      title: t('quota_usage.date'),
      dataIndex: 'date',
      width: 120,
      render: (value: string) => dayjs(value).format('DD.MM.YYYY'),
    },
    {
      title: t('quota_usage.firm_count'),
      dataIndex: 'firmCount',
      width: 100,
      align: 'center',
      render: (value: number) => <Tag color="purple">{value}</Tag>,
    },
    {
      title: `${t('quota_usage.kg_used')} (${weightSuffix(weightUnit)})`,
      dataIndex: 'totalKg',
      width: 150,
      align: 'right',
      render: (value: number) => (
        <Text strong style={{ color: COLORS.primary }}>{fmtWeight(value, weightUnit)}</Text>
      ),
    },
  ];

  return (
    <div>
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Space>
          <Button
            icon={<LeftOutlined />}
            onClick={() => setSelectedMonth((m) => m.subtract(1, 'month'))}
            aria-label={t('quota_usage.prev_month')}
          />
          <DatePicker
            picker="month"
            value={selectedMonth}
            onChange={(d) => d && setSelectedMonth(d)}
            allowClear={false}
            style={{ width: 160 }}
          />
          <Button
            icon={<RightOutlined />}
            onClick={() => setSelectedMonth((m) => m.add(1, 'month'))}
            aria-label={t('quota_usage.next_month')}
          />
          <Text type="secondary">
            {t('quota_usage.total_records', { count: records.length })}
          </Text>
        </Space>
        <Text strong style={{ color: COLORS.primary }}>
          {t('quota_usage.grid_total')}: {fmtWeight(totalKg(groups), weightUnit)}{' '}
          {weightSuffix(weightUnit)}
        </Text>
      </Flex>

      {isError && (
        <Alert type="error" message={t('quota_usage.load_error')} style={{ marginBottom: 12 }} />
      )}

      <Table<IUsageGroup>
        columns={columns}
        dataSource={groups}
        rowKey="key"
        size="small"
        bordered
        loading={isLoading}
        pagination={false}
        locale={{ emptyText: t('quota_usage.grid_empty') }}
        expandable={{
          expandedRowRender: (group) => (
            <QuotaUsageFirmRows records={group.records} weightUnit={weightUnit} />
          ),
        }}
      />
    </div>
  );
}
