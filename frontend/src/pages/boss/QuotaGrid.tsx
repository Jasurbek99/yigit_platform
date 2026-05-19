import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Tooltip, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { BossPeriod, IBossQuotaFirm } from '@/hooks/useBossDashboard';
import { useBossQuotaGrid } from '@/hooks/useBossDashboard';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

const LEVEL_COLORS: Record<IBossQuotaFirm['level'], { bg: string; border: string; text: string; bar: string }> = {
  ok: { bg: COLORS.bgGreen, border: '#b7eb8f', text: '#237804', bar: COLORS.success },
  warn: { bg: COLORS.bgYellow, border: '#ffe58f', text: '#874d00', bar: COLORS.warning },
  alert: { bg: COLORS.bgRed, border: '#ffa39e', text: '#a8071a', bar: COLORS.danger },
};

interface IQuotaGridProps {
  period: BossPeriod;
}

export function QuotaGrid({ period }: IQuotaGridProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useBossQuotaGrid(period);

  const firms = data?.rows ?? [];

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.quota_grid')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0', marginBottom: 16 }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 8,
          }}
        >
          {firms.map((firm) => {
            const colors = LEVEL_COLORS[firm.level];
            return (
              <Tooltip
                key={firm.firm_id}
                title={`${firm.firm_name}: ${firm.used_pct.toFixed(1)}%`}
              >
                <div
                  onClick={() => navigate(`/export/quota?firm=${firm.firm_id}`)}
                  style={{
                    background: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    padding: '8px 10px',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: COLORS.textTertiary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginBottom: 4,
                    }}
                  >
                    {firm.firm_name}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: colors.text, lineHeight: 1 }}>
                    {firm.used_pct.toFixed(0)}%
                  </div>
                  {/* Mini bar */}
                  <div style={{ background: '#e8e8e8', borderRadius: 2, height: 4, marginTop: 6 }}>
                    <div
                      style={{
                        width: `${Math.min(firm.used_pct, 100)}%`,
                        background: colors.bar,
                        height: 4,
                        borderRadius: 2,
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                </div>
              </Tooltip>
            );
          })}
          {firms.length === 0 && (
            <Text type="secondary" style={{ fontSize: 13 }}>{t('boss_dashboard.no_data')}</Text>
          )}
        </div>
      )}
    </Card>
  );
}
