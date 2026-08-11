import { Button, InputNumber, Modal, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { useUpdateQuotaUsage, useDeleteQuotaUsage } from '@/hooks/useQuotaUsage';
import { fmtWeight, weightSuffix, type WeightUnit } from '@/utils/weight';
import type { IQuotaUsageRecord } from '@/types';

interface IQuotaUsageFirmRowsProps {
  records: IQuotaUsageRecord[];
  weightUnit: WeightUnit;
}

/** The per-firm rows inside one expanded truck (or the manual bucket). */
export function QuotaUsageFirmRows({ records, weightUnit }: IQuotaUsageFirmRowsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canEdit = canDo(user, 'quota_usage', 'edit');
  const canDelete = canDo(user, 'quota_usage', 'delete');
  const updateMutation = useUpdateQuotaUsage();
  const deleteMutation = useDeleteQuotaUsage();

  const columns: TableColumnsType<IQuotaUsageRecord> = [
    {
      title: t('quota_usage.firm'),
      dataIndex: 'export_firm_name',
      render: (_: unknown, r: IQuotaUsageRecord) => (
        <Typography.Text strong>{r.export_firm_name}</Typography.Text>
      ),
    },
    {
      title: t('quota_usage.date'),
      dataIndex: 'usage_date',
      width: 120,
      render: (value: string) => dayjs(value).format('DD.MM.YYYY'),
    },
    {
      title: `${t('quota_usage.kg_used')} (${weightSuffix(weightUnit)})`,
      dataIndex: 'kg_used',
      width: 160,
      align: 'right',
      render: (_: unknown, r: IQuotaUsageRecord) =>
        canEdit ? (
          <InputNumber
            defaultValue={r.kg_used}
            min={1}
            step={100}
            size="small"
            style={{ width: 120 }}
            onBlur={(e) => {
              const next = Number(e.target.value.replace(/,/g, '')) || 0;
              if (next !== r.kg_used && next > 0) {
                updateMutation.mutate(
                  { id: r.id, kg_used: next },
                  { onError: () => toast.error(t('quota_usage.save_error')) },
                );
              }
            }}
            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
          />
        ) : (
          fmtWeight(r.kg_used, weightUnit)
        ),
    },
    ...(canDelete
      ? [
          {
            title: '',
            key: 'actions',
            width: 50,
            render: (_: unknown, r: IQuotaUsageRecord) => (
              <Button
                size="small"
                danger
                type="link"
                icon={<DeleteOutlined />}
                onClick={() =>
                  Modal.confirm({
                    title: t('quota_usage.confirm_delete'),
                    okType: 'danger',
                    onOk: () => deleteMutation.mutate(r.id),
                  })
                }
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <Table<IQuotaUsageRecord>
      columns={columns}
      dataSource={records}
      rowKey="id"
      size="small"
      pagination={false}
      showHeader={false}
    />
  );
}
