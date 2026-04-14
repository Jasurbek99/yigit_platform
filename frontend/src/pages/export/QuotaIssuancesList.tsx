import { Button, Modal, Progress, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useQuotaIssuances, useDeleteQuotaIssuance } from '@/hooks/useQuotaDashboard';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { fmtWeight, weightSuffix, type WeightUnit } from '@/utils/weight';

const { Text } = Typography;

export function computeExpiry(issueDate: string, validity: string): dayjs.Dayjs {
  const d = dayjs(issueDate);
  if (validity === 'this_month') return d.endOf('month');
  if (validity === 'next_month') return d.add(1, 'month').endOf('month');
  if (validity === 'this_and_next') return d.add(1, 'month').endOf('month');
  return d.endOf('month'); // safe fallback
}

type QuotaRowStatus = 'active' | 'expiring' | 'expired';
const STATUS_CONFIG: Record<QuotaRowStatus, { color: string }> = {
  active: { color: 'green' },
  expiring: { color: 'orange' },
  expired: { color: 'red' },
};
const STATUS_ORDER: Record<QuotaRowStatus, number> = { active: 0, expiring: 1, expired: 2 };

function usageColor(pct: number): string {
  if (pct >= 80) return '#52c41a';
  if (pct >= 30) return '#fa8c16';
  return '#ff4d4f';
}

interface IFlatQuotaRow {
  key: string;
  alloc_id: number;
  issuance_id: number;
  export_firm_name: string;
  kg_quota: number;
  used_kg: number;
  issue_date: string;
  product_type: string;
  validity: string;
  expiry_date: string;
  status: QuotaRowStatus;
  days_left: number;
}

interface IQuotaIssuancesListProps {
  weightUnit: WeightUnit;
}

export function QuotaIssuancesList({ weightUnit }: IQuotaIssuancesListProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: issuances = [], isLoading } = useQuotaIssuances();
  const deleteMutation = useDeleteQuotaIssuance();
  const canDelete = canDo(user, 'quota_issuance', 'delete');

  const today = dayjs();

  const flatRows: IFlatQuotaRow[] = issuances.flatMap((iss) =>
    iss.allocations.map((a) => {
      const expiry = computeExpiry(iss.issue_date, iss.validity);
      const daysLeft = expiry.diff(today, 'day');
      let status: QuotaRowStatus = 'active';
      if (daysLeft < 0) status = 'expired';
      else if (daysLeft <= 7) status = 'expiring';

      return {
        key: `${iss.id}-${a.export_firm}`,
        alloc_id: a.id,
        issuance_id: iss.id,
        export_firm_name: a.export_firm_name ?? '',
        kg_quota: a.kg_quota,
        used_kg: a.used_kg ?? 0,
        issue_date: iss.issue_date,
        product_type: iss.product_type,
        validity: iss.validity,
        expiry_date: expiry.format('YYYY-MM-DD'),
        status,
        days_left: daysLeft,
      };
    })
  );

  const sorted = [...flatRows].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    return b.issue_date.localeCompare(a.issue_date);
  });

  const columns = [
    {
      title: '#', dataIndex: 'alloc_id', width: 60,
      sorter: (a: IFlatQuotaRow, b: IFlatQuotaRow) => a.alloc_id - b.alloc_id,
    },
    {
      title: t('quota_dashboard.firm'), dataIndex: 'export_firm_name', width: 160,
      sorter: (a: IFlatQuotaRow, b: IFlatQuotaRow) => a.export_firm_name.localeCompare(b.export_firm_name),
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: t('quota_dashboard.issued'), dataIndex: 'kg_quota', width: 120, align: 'right' as const,
      sorter: (a: IFlatQuotaRow, b: IFlatQuotaRow) => a.kg_quota - b.kg_quota,
      render: (v: number) => `${fmtWeight(v, weightUnit)} ${weightSuffix(weightUnit)}`,
    },
    {
      title: t('quota_dashboard.used'), dataIndex: 'used_kg', width: 120, align: 'right' as const,
      sorter: (a: IFlatQuotaRow, b: IFlatQuotaRow) => a.used_kg - b.used_kg,
      render: (v: number) => `${fmtWeight(v, weightUnit)} ${weightSuffix(weightUnit)}`,
    },
    {
      title: t('quota_dashboard.usage'), key: 'usage_bar', width: 130,
      sorter: (a: IFlatQuotaRow, b: IFlatQuotaRow) => {
        const pctA = a.kg_quota > 0 ? a.used_kg / a.kg_quota : 0;
        const pctB = b.kg_quota > 0 ? b.used_kg / b.kg_quota : 0;
        return pctA - pctB;
      },
      render: (_: unknown, r: IFlatQuotaRow) => {
        const pct = r.kg_quota > 0 ? Math.round((r.used_kg / r.kg_quota) * 100) : 0;
        return (
          <Progress
            percent={pct}
            size="small"
            strokeColor={usageColor(pct)}
            format={(p) => `${p}%`}
          />
        );
      },
    },
    {
      title: t('quota_dashboard.issue_date'), dataIndex: 'issue_date', width: 110,
      sorter: (a: IFlatQuotaRow, b: IFlatQuotaRow) => a.issue_date.localeCompare(b.issue_date),
    },
    {
      title: t('quota_dashboard.expiry'), dataIndex: 'expiry_date', width: 110,
      sorter: (a: IFlatQuotaRow, b: IFlatQuotaRow) => a.expiry_date.localeCompare(b.expiry_date),
    },
    {
      title: t('quota_dashboard.status'), dataIndex: 'status', width: 100,
      sorter: (a: IFlatQuotaRow, b: IFlatQuotaRow) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
      render: (v: QuotaRowStatus) => (
        <Tag color={STATUS_CONFIG[v].color}>{t(`quota_dashboard.status_${v}`)}</Tag>
      ),
    },
    {
      title: t('quota_dashboard.days_left'), dataIndex: 'days_left', width: 100,
      sorter: (a: IFlatQuotaRow, b: IFlatQuotaRow) => a.days_left - b.days_left,
      render: (v: number) => {
        if (v < 0) return <Text type="danger">{t('quota_dashboard.expired_ago', { days: Math.abs(v) })}</Text>;
        if (v === 0) return <Text type="warning">{t('quota_dashboard.expires_today')}</Text>;
        return <Text>{v} {t('quota_dashboard.days')}</Text>;
      },
    },
    {
      title: t('quota_dashboard.batch'), dataIndex: 'issuance_id', width: 65,
      sorter: (a: IFlatQuotaRow, b: IFlatQuotaRow) => a.issuance_id - b.issuance_id,
      render: (v: number) => <Text type="secondary">#{v}</Text>,
    },
    ...(canDelete ? [{
      title: '', key: 'actions', width: 60,
      render: (_: unknown, r: IFlatQuotaRow) => (
        <Button
          size="small" danger type="link"
          onClick={() => {
            Modal.confirm({
              title: t('quota_dashboard.confirm_delete'),
              okType: 'danger',
              onOk: () => deleteMutation.mutate(r.issuance_id),
            });
          }}
        >
          {t('common.delete')}
        </Button>
      ),
    }] : []),
  ];

  return (
    <Table
      dataSource={sorted}
      columns={columns}
      rowKey="key"
      size="small"
      loading={isLoading}
      pagination={false}
      scroll={{ x: 1200 }}
      rowClassName={(r) => r.status === 'expired' ? 'ant-table-row-expired' : ''}
    />
  );
}
