import { useState } from 'react';
import {
  Button,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import {
  useQuotaUsageRecords,
  useUpdateQuotaUsage,
  useDeleteQuotaUsage,
  useBulkApproveQuotaUsage,
} from '@/hooks/useQuotaUsage';
import { fmtWeight, weightSuffix, type WeightUnit } from '@/utils/weight';
import { QuotaUsageGrid } from './QuotaUsageGrid';
import type { IQuotaUsageRecord, QuotaUsageStatus } from '@/types';

const { Text } = Typography;

type ViewMode = 'list' | 'grid';

interface IQuotaUsageTabProps {
  weightUnit: WeightUnit;
}

export function QuotaUsageTab({ weightUnit }: IQuotaUsageTabProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canEdit = canDo(user, 'quota_usage', 'edit');
  const canDelete = canDo(user, 'quota_usage', 'delete');

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data: records = [], isLoading } = useQuotaUsageRecords({ status: statusFilter });
  const updateMutation = useUpdateQuotaUsage();
  const deleteMutation = useDeleteQuotaUsage();
  const approveMutation = useBulkApproveQuotaUsage();

  function handleApprove() {
    const draftIds = selectedIds.filter(
      (id) => records.find((r) => r.id === id)?.status === 'draft'
    );
    if (!draftIds.length) return;
    approveMutation.mutate(draftIds, {
      onSuccess: (data) => {
        message.success(t('quota_usage.approved_count', { count: data.approved }));
        setSelectedIds([]);
      },
    });
  }

  function handleInlineEdit(record: IQuotaUsageRecord, field: string, value: unknown) {
    updateMutation.mutate(
      { id: record.id, [field]: value },
      { onError: () => message.error(t('quota_usage.save_error')) },
    );
  }

  const viewToggle = (
    <Space size={4}>
      <Button
        type={viewMode === 'grid' ? 'primary' : 'default'}
        icon={<AppstoreOutlined />}
        size="small"
        onClick={() => setViewMode('grid')}
      />
      <Button
        type={viewMode === 'list' ? 'primary' : 'default'}
        icon={<UnorderedListOutlined />}
        size="small"
        onClick={() => setViewMode('list')}
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
        <QuotaUsageGrid weightUnit={weightUnit} />
      </div>
    );
  }

  // ─── List view ─────────────────────────────────────────────────────────

  const draftCount = records.filter((r) => r.status === 'draft').length;
  const selectedDraftCount = selectedIds.filter(
    (id) => records.find((r) => r.id === id)?.status === 'draft'
  ).length;

  const columns = [
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
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: t('quota_usage.cargo_code'),
      dataIndex: 'cargo_code',
      width: 130,
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: `${t('quota_usage.kg_used')} (${weightSuffix(weightUnit)})`,
      dataIndex: 'kg_used',
      width: 130,
      align: 'right' as const,
      sorter: (a: IQuotaUsageRecord, b: IQuotaUsageRecord) => a.kg_used - b.kg_used,
      render: (v: number, r: IQuotaUsageRecord) => {
        if (canEdit && r.status === 'draft') {
          return (
            <InputNumber
              defaultValue={v}
              min={1}
              step={100}
              suffix="kg"
              size="small"
              style={{ width: 100 }}
              onBlur={(e) => {
                const newVal = Number(e.target.value.replace(/,/g, '')) || 0;
                if (newVal !== v && newVal > 0) handleInlineEdit(r, 'kg_used', newVal);
              }}
              formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            />
          );
        }
        return `${fmtWeight(v, weightUnit)} ${weightSuffix(weightUnit)}`;
      },
    },
    {
      title: t('quota_usage.product_type'),
      dataIndex: 'product_type',
      width: 100,
      render: (v: string) =>
        v === 'pepper' ? t('quota_dashboard.product_pepper') : t('quota_dashboard.product_tomato'),
    },
    {
      title: t('quota_usage.status'),
      dataIndex: 'status',
      width: 110,
      render: (v: QuotaUsageStatus) => (
        <Tag
          color={v === 'approved' ? 'success' : 'default'}
          icon={v === 'approved' ? <CheckCircleOutlined /> : <EditOutlined />}
        >
          {t(`quota_usage.status_${v}`)}
        </Tag>
      ),
    },
    {
      title: t('quota_usage.created_by'),
      dataIndex: 'created_by_name',
      width: 120,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('quota_usage.approved_by'),
      dataIndex: 'approved_by_name',
      width: 120,
      render: (v: string | null) => v ?? '—',
    },
    ...(canDelete
      ? [
          {
            title: '',
            key: 'actions',
            width: 50,
            render: (_: unknown, r: IQuotaUsageRecord) =>
              r.status === 'draft' ? (
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
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            allowClear
            placeholder={t('quota_usage.filter_status')}
            style={{ width: 150 }}
            options={[
              { label: t('quota_usage.status_draft'), value: 'draft' },
              { label: t('quota_usage.status_approved'), value: 'approved' },
            ]}
          />
          <Text type="secondary">
            {t('quota_usage.total_records', { count: records.length })}
            {draftCount > 0 && ` · ${draftCount} ${t('quota_usage.pending')}`}
          </Text>
        </Space>

        <Space>
          {canEdit && selectedDraftCount > 0 && (
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={handleApprove}
              loading={approveMutation.isPending}
            >
              {t('quota_usage.approve')} ({selectedDraftCount})
            </Button>
          )}
          {viewToggle}
        </Space>
      </div>

      <Table<IQuotaUsageRecord>
        dataSource={records}
        columns={columns}
        rowKey="id"
        size="small"
        loading={isLoading}
        pagination={false}
        scroll={{ x: 1100 }}
        rowSelection={
          canEdit
            ? {
                selectedRowKeys: selectedIds,
                onChange: (keys) => setSelectedIds(keys as number[]),
                getCheckboxProps: (r) => ({ disabled: r.status !== 'draft' }),
              }
            : undefined
        }
        rowClassName={(r) => (r.status === 'draft' ? 'row-draft' : '')}
      />
    </div>
  );
}
