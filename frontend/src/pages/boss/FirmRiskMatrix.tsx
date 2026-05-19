import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Table, Tag, Typography } from 'antd';
import type { BossPeriod, IBossRiskFirm } from '@/hooks/useBossDashboard';
import { useBossRiskMatrix } from '@/hooks/useBossDashboard';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

const RISK_COLORS: Record<IBossRiskFirm['risk_level'], string> = {
  low: 'green',
  med: 'orange',
  high: 'red',
};

interface IFirmRiskMatrixProps {
  period: BossPeriod;
}

export function FirmRiskMatrix({ period }: IFirmRiskMatrixProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useBossRiskMatrix(period);

  const firms = [...(data?.rows ?? [])].sort((a, b) => {
    const order = { high: 0, med: 1, low: 2 };
    return order[a.risk_level] - order[b.risk_level];
  });

  const columns = [
    {
      title: t('boss_dashboard.risk_matrix.col_firm'),
      dataIndex: 'firm_name',
      key: 'firm_name',
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: (
        <span>
          {t('boss_dashboard.risk_matrix.col_debt')}
          <Tag color="orange" style={{ fontSize: 9, marginLeft: 4 }}>{t('common.demo_badge')}</Tag>
        </span>
      ),
      dataIndex: 'debt_usd',
      key: 'debt_usd',
      align: 'right' as const,
      render: (v: number, row: IBossRiskFirm) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace', color: row.debt_placeholder ? COLORS.textSecondary : undefined }}>
          {row.debt_placeholder ? '—' : `$${(v / 1000).toFixed(0)}k`}
        </Text>
      ),
    },
    {
      title: t('boss_dashboard.risk_matrix.col_quota_pct'),
      dataIndex: 'quota_pct',
      key: 'quota_pct',
      align: 'right' as const,
      render: (v: number) => {
        const color = v >= 95 ? COLORS.danger : v >= 80 ? COLORS.warning : COLORS.success;
        return <Text style={{ fontSize: 12, color }}>{v.toFixed(1)}%</Text>;
      },
    },
    {
      title: t('boss_dashboard.risk_matrix.col_risk'),
      dataIndex: 'risk_level',
      key: 'risk_level',
      render: (v: IBossRiskFirm['risk_level']) => (
        <Tag color={RISK_COLORS[v]} style={{ fontSize: 11 }}>
          {t(`boss_dashboard.risk.${v}`)}
        </Tag>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.risk_matrix')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : (
        <Table
          dataSource={firms}
          columns={columns}
          rowKey={(r) => String(r.firm_id)}
          size="small"
          pagination={false}
          scroll={{ x: 'max-content', y: 240 }}
        />
      )}
    </Card>
  );
}
