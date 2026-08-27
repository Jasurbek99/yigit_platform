import { Table, Tag, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useQuotaFirmSummary, type IQuotaFirmSummaryRow } from '@/hooks/useQuotaDashboard';
import { fmtWeight, weightSuffix, type WeightUnit } from '@/utils/weight';
import { COLORS } from '@/constants/styles';
import {
  buildFirmQuotaTotals,
  expiryStatus,
  sortFirmQuotaRows,
  type FirmQuotaExpiryStatus,
} from './QuotaFirmSummary.helpers';

interface IProps {
  seasonId: number | undefined;
  productType: string;
  weightUnit: WeightUnit;
}

const TAG_COLOR: Record<FirmQuotaExpiryStatus, string> = {
  active: 'green',
  expiring: 'orange',
  expired: 'red',
};

/**
 * Firm Quota tab — "which firm holds how much quota right now".
 *
 * Season-scoped and deliberately NOT period-filtered: quota lives roughly a
 * month, so the current balance is the question, and a week/month filter would
 * hide live quota. `remaining_kg` is the same figure that blocks a firm in the
 * shipment firm-split editor.
 *
 * `issued`/`used` here count LIVE allocations only, which is why both headers
 * say "(active)" — the Firm Breakdown tab one click away shows the period-scoped
 * figures under similar names, and the two are not meant to match.
 */
export function QuotaFirmSummaryTable({ seasonId, productType, weightUnit }: IProps) {
  const { t } = useTranslation();
  const { data: rows = [], isLoading } = useQuotaFirmSummary(seasonId, productType);

  const fw = (v: number) => fmtWeight(v, weightUnit);
  const sorted = sortFirmQuotaRows(rows);
  const totals = buildFirmQuotaTotals(sorted);
  const today = dayjs();

  const columns = [
    {
      title: t('quota_dashboard.firm'),
      dataIndex: 'export_firm_name',
      key: 'firm',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: t('quota_dashboard.active_quotas'),
      dataIndex: 'active_issuance_count',
      key: 'active_issuance_count',
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v === 0 ? COLORS.textMuted : undefined }}>{v}</span>
      ),
      sorter: (a: IQuotaFirmSummaryRow, b: IQuotaFirmSummaryRow) =>
        a.active_issuance_count - b.active_issuance_count,
    },
    {
      title: `${t('quota_dashboard.active_issued')} (${weightSuffix(weightUnit)})`,
      dataIndex: 'issued_kg',
      key: 'issued_kg',
      align: 'right' as const,
      render: (v: number) => fw(v),
      sorter: (a: IQuotaFirmSummaryRow, b: IQuotaFirmSummaryRow) => a.issued_kg - b.issued_kg,
    },
    {
      title: (
        <span>
          {t('quota_dashboard.active_used')}{' '}
          <Tooltip title={t('quota_dashboard.active_used_tip')}>
            <QuestionCircleOutlined style={{ fontSize: 10, color: COLORS.textMuted, cursor: 'help' }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'used_kg',
      key: 'used_kg',
      align: 'right' as const,
      render: (v: number) => fw(v),
      sorter: (a: IQuotaFirmSummaryRow, b: IQuotaFirmSummaryRow) => a.used_kg - b.used_kg,
    },
    {
      title: t('quota_dashboard.remaining'),
      dataIndex: 'remaining_kg',
      key: 'remaining_kg',
      align: 'right' as const,
      defaultSortOrder: 'descend' as const,
      render: (v: number) => (
        <span style={{ fontWeight: 600, color: v <= 0 ? COLORS.danger : undefined }}>{fw(v)}</span>
      ),
      sorter: (a: IQuotaFirmSummaryRow, b: IQuotaFirmSummaryRow) => a.remaining_kg - b.remaining_kg,
    },
    {
      title: t('quota_dashboard.nearest_expiry'),
      dataIndex: 'nearest_expiry',
      key: 'nearest_expiry',
      render: (_: string | null, r: IQuotaFirmSummaryRow) => {
        const exp = expiryStatus(r.nearest_expiry, today);
        if (!exp) return <span style={{ color: COLORS.textMuted }}>{t('quota_dashboard.no_live_quota')}</span>;
        return (
          <span>
            {r.nearest_expiry}{' '}
            <Tag color={TAG_COLOR[exp.status]} style={{ marginInlineEnd: 0 }}>
              {exp.status === 'expired'
                ? t('quota_dashboard.status_expired')
                : `${exp.daysLeft} ${t('quota_dashboard.days')}`}
            </Tag>
          </span>
        );
      },
    },
  ];

  const summaryRow = (
    <Table.Summary.Row style={{ background: COLORS.bgLayout, fontWeight: 600 }}>
      <Table.Summary.Cell index={0}>{t('quota_dashboard.total')}</Table.Summary.Cell>
      <Table.Summary.Cell index={1} align="right">{totals.active_issuance_count}</Table.Summary.Cell>
      <Table.Summary.Cell index={2} align="right">{fw(totals.issued_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={3} align="right">{fw(totals.used_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={4} align="right">{fw(totals.remaining_kg)}</Table.Summary.Cell>
      <Table.Summary.Cell index={5}>—</Table.Summary.Cell>
    </Table.Summary.Row>
  );

  return (
    <>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        {t('quota_dashboard.firm_quota_hint')}
      </Typography.Text>
      <Table<IQuotaFirmSummaryRow>
        dataSource={sorted}
        columns={columns}
        rowKey="export_firm"
        size="small"
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        summary={() => summaryRow}
        locale={{ emptyText: t('quota_dashboard.firm_quota_empty') }}
      />
    </>
  );
}
