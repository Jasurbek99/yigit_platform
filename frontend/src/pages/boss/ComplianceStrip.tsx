import { useTranslation } from 'react-i18next';
import { Card, Progress, Skeleton, Tag, Typography } from 'antd';
import type { BossPeriod } from '@/hooks/useBossDashboard';
import { useBossCompliance, useBossOpsPulse } from '@/hooks/useBossDashboard';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IComplianceStripProps {
  period: BossPeriod;
}

export function ComplianceStrip({ period }: IComplianceStripProps) {
  const { t } = useTranslation();
  const { data: comp, isLoading: compLoading } = useBossCompliance(period);
  const { data: ops, isLoading: opsLoading } = useBossOpsPulse(period);

  const isLoading = compLoading || opsLoading;

  const oneToTenPct = comp
    ? Math.round((comp.quota_1_to_10.compliant_firms / Math.max(comp.quota_1_to_10.total_firms, 1)) * 100)
    : 0;

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.compliance')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Reports overdue */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 12, fontWeight: 500 }}>{t('boss_dashboard.compliance.reports_overdue')}</Text>
            <Tag color={(comp?.reports_overdue ?? 0) > 0 ? 'red' : 'green'}>
              {comp?.reports_overdue ?? 0}
            </Tag>
          </div>

          {/* 1:10 quota rule */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: 500 }}>{t('boss_dashboard.compliance.one_to_ten')}</Text>
              <Text style={{ fontSize: 12 }}>
                {comp?.quota_1_to_10.compliant_firms ?? 0} / {comp?.quota_1_to_10.total_firms ?? 0}
              </Text>
            </div>
            <Progress
              percent={oneToTenPct}
              size="small"
              strokeColor={oneToTenPct >= 80 ? COLORS.success : COLORS.warning}
              showInfo={false}
            />
          </div>

          {/* Docs by 13:00 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: 500 }}>{t('boss_dashboard.compliance.docs_by_13')}</Text>
              <Text style={{ fontSize: 12 }}>
                {comp?.docs_by_13.ready ?? 0} / {comp?.docs_by_13.total ?? 0}
              </Text>
            </div>
            <Progress
              percent={comp?.docs_by_13.percent ?? 0}
              size="small"
              strokeColor={(comp?.docs_by_13.percent ?? 0) >= 90 ? COLORS.success : COLORS.warning}
              showInfo={false}
            />
          </div>

          {/* Ops pulse counters */}
          <div style={{ borderTop: '1px solid #f5f5f5', paddingTop: 10, marginTop: 4 }}>
            <Text style={{ fontSize: 11, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('boss_dashboard.section.ops_pulse')}
            </Text>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
                marginTop: 8,
              }}
            >
              {[
                { key: 'en_route', labelKey: 'boss_dashboard.ops_pulse.en_route', value: ops?.en_route },
                { key: 'at_border', labelKey: 'boss_dashboard.ops_pulse.at_border', value: ops?.at_border },
                { key: 'in_market', labelKey: 'boss_dashboard.ops_pulse.in_market', value: ops?.in_market },
                { key: 'loaded_today', labelKey: 'boss_dashboard.ops_pulse.loaded_today', value: ops?.loaded_today },
              ].map(({ key, labelKey, value }) => (
                <div
                  key={key}
                  style={{
                    background: COLORS.bgLayout,
                    borderRadius: 6,
                    padding: '6px 10px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{value ?? 0}</div>
                  <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 2 }}>{t(labelKey)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
