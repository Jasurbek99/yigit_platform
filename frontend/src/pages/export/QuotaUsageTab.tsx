import { useState } from 'react';
import { Button, InputNumber, Modal, Space, Tag, Typography } from 'antd';
import { toast } from 'sonner';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { AppstoreOutlined, DeleteOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import {
  useQuotaUsageRecords,
  useUpdateQuotaUsage,
  useDeleteQuotaUsage,
} from '@/hooks/useQuotaUsage';
import { fmtWeight, weightSuffix, type WeightUnit } from '@/utils/weight';
import { QuotaUsageGrid } from './QuotaUsageGrid';
import type { IQuotaUsageRecord } from '@/types';

const { Text } = Typography;

type ViewMode = 'list' | 'grid';

interface IQuotaUsageTabProps {
  weightUnit: WeightUnit;
  productType: string;
}

export function QuotaUsageTab({ weightUnit, productType }: IQuotaUsageTabProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canEdit = canDo(user, 'quota_usage', 'edit');
  const canDelete = canDo(user, 'quota_usage', 'delete');

  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const { data: records = [], isLoading } = useQuotaUsageRecords(
    {},
    { enabled: viewMode === 'list' },
  );
  const updateMutation = useUpdateQuotaUsage();
  const deleteMutation = useDeleteQuotaUsage();

  function handleInlineEdit(record: IQuotaUsageRecord, field: string, value: unknown) {
    updateMutation.mutate(
      { id: record.id, [field]: value },
      { onError: () => toast.error(t('quota_usage.save_error')) },
    );
  }

  const viewToggle = (
    <Space size={4}>
      <Button
        type={viewMode === 'grid' ? 'primary' : 'default'}
        icon={<AppstoreOutlined />}
        size="small"
        onClick={() => setViewMode('grid')}
        aria-label={t('quota_usage.view_grid')}
      />
      <Button
        type={viewMode === 'list' ? 'primary' : 'default'}
        icon={<UnorderedListOutlined />}
        size="small"
        onClick={() => setViewMode('list')}
        aria-label={t('quota_usage.view_list')}
      />
    </Space>
  );

  // ─── Grid view ─────────────────────────────────────────────────────────

  if (viewMode === 'grid') {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          {viewToggle}
        </div>
        <QuotaUsageGrid weightUnit={weightUnit} productType={productType} />
      </div>
    );
  }

  // ─── List view ─────────────────────────────────────────────────────────

  const columns: ProColumns<IQuotaUsageRecord>[] = [
    {
      title: t('quota_usage.date'),
      dataIndex: 'usage_date',
      width: 110,
      sorter: (a: IQuotaUsageRecord, b: IQuotaUsageRecord) => a.usage_date.localeCompare(b.usage_date),
    },
    {
      title: t('quota_usage.firm'),
      dataIndex: 'export_firm_name',
      width: 160,
      sorter: (a: IQuotaUsageRecord, b: IQuotaUsageRecord) =>
        a.export_firm_name.localeCompare(b.export_firm_name),
      render: (_: unknown, r: IQuotaUsageRecord) => <Text strong>{r.export_firm_name}</Text>,
    },
    {
      title: t('quota_usage.source'),
      key: 'source',
      width: 110,
      render: (_: unknown, r: IQuotaUsageRecord) =>
        r.shipment_code ? (
          <Tag color="blue" icon={<AppstoreOutlined />}>{t('quota_usage.source_auto')}</Tag>
        ) : (
          <Tag>{t('quota_usage.source_manual')}</Tag>
        ),
    },
    {
      title: t('quota_usage.shipment_code'),
      dataIndex: 'shipment_code',
      width: 130,
      render: (_: unknown, r: IQuotaUsageRecord) => r.shipment_code ?? <Text type="secondary">—</Text>,
    },
    {
      title: `${t('quota_usage.kg_used')} (${weightSuffix(weightUnit)})`,
      dataIndex: 'kg_used',
      width: 130,
      align: 'right' as const,
      sorter: (a: IQuotaUsageRecord, b: IQuotaUsageRecord) => a.kg_used - b.kg_used,
      render: (_: unknown, r: IQuotaUsageRecord) => {
        if (canEdit) {
          return (
            <InputNumber
              defaultValue={r.kg_used}
              min={1}
              step={100}
              suffix="kg"
              size="small"
              style={{ width: 100 }}
              onBlur={(e) => {
                const newVal = Number(e.target.value.replace(/,/g, '')) || 0;
                if (newVal !== r.kg_used && newVal > 0) handleInlineEdit(r, 'kg_used', newVal);
              }}
              formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            />
          );
        }
        return `${fmtWeight(r.kg_used, weightUnit)} ${weightSuffix(weightUnit)}`;
      },
    },
    {
      title: t('quota_usage.product_type'),
      dataIndex: 'product_type',
      width: 100,
      render: (_: unknown, r: IQuotaUsageRecord) =>
        r.product_type === 'pepper' ? t('quota_dashboard.product_pepper') : t('quota_dashboard.product_tomato'),
    },
    {
      title: t('quota_usage.created_by'),
      dataIndex: 'created_by_name',
      width: 120,
      render: (_: unknown, r: IQuotaUsageRecord) => r.created_by_name ?? '—',
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
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text type="secondary">
          {t('quota_usage.total_records', { count: records.length })}
        </Text>

        {viewToggle}
      </div>

      <ProTable<IQuotaUsageRecord>
        dataSource={records}
        columns={columns}
        rowKey="id"
        size="small"
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        scroll={{ x: 970 }}
      />
    </div>
  );
}
