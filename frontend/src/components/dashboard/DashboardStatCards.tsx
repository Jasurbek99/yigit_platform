import { Card, Col, Row } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';
import type { IDashboardStats } from '@/hooks/useDashboardSummary';

interface IDashboardStatCardsProps {
  stats: IDashboardStats;
}

interface IStatConfig {
  icon: string;
  color: string;
  iconColor: string;
  value: number;
  labelKey: string;
  trendKey: string;
  trendParams?: Record<string, string | number>;
  trendUp: boolean | null;
  onClick?: () => void;
}

export function DashboardStatCards({ stats }: IDashboardStatCardsProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const statConfigs: IStatConfig[] = [
    {
      icon: '📦',
      color: COLORS.bgBlue,
      iconColor: COLORS.primary,
      value: stats.total.value,
      labelKey: 'dashboard.stat_total',
      trendKey: stats.total.delta_7d != null ? 'dashboard.trend_this_week' : 'dashboard.trend_moving',
      trendParams: stats.total.delta_7d != null ? { count: stats.total.delta_7d } : undefined,
      trendUp: stats.total.delta_7d != null ? true : null,
      onClick: () => navigate('/export/shipments'),
    },
    {
      icon: '🚛',
      color: COLORS.bgCyan,
      iconColor: '#13c2c2',
      value: stats.in_transit.value,
      labelKey: 'dashboard.stat_transit',
      trendKey: 'dashboard.trend_moving',
      trendUp: null,
    },
    {
      icon: '🛒',
      color: COLORS.bgYellow,
      iconColor: COLORS.warning,
      value: stats.selling.value,
      labelKey: 'dashboard.stat_selling',
      trendKey: 'dashboard.trend_at_market',
      trendUp: null,
    },
    {
      icon: '✅',
      color: COLORS.bgGreen,
      iconColor: COLORS.success,
      value: stats.completed.value,
      labelKey: 'dashboard.stat_sold',
      trendKey: stats.completed.delta_7d != null ? 'dashboard.trend_this_week' : 'dashboard.trend_moving',
      trendParams: stats.completed.delta_7d != null ? { count: stats.completed.delta_7d } : undefined,
      trendUp: stats.completed.delta_7d != null ? true : null,
    },
    {
      icon: '⚠️',
      color: COLORS.bgRed,
      iconColor: COLORS.danger,
      value: stats.no_report.value,
      labelKey: 'dashboard.stat_no_report',
      trendKey: 'dashboard.trend_awaiting',
      trendUp: false,
    },
    {
      icon: '📐',
      color: COLORS.bgPurple,
      iconColor: COLORS.purple,
      value: stats.quota_firms.value,
      labelKey: 'dashboard.stat_firms',
      trendKey: 'dashboard.trend_tracking_quota',
      trendUp: null,
      onClick: () => navigate('/export/quota'),
    },
  ];

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
      {statConfigs.map((stat, i) => (
        <Col key={i} xs={12} sm={8} xl={4}>
          <Card
            style={{
              borderRadius: 12,
              cursor: stat.onClick ? 'pointer' : 'default',
              height: '100%',
            }}
            styles={{ body: { padding: 16 } }}
            onClick={stat.onClick}
            hoverable={!!stat.onClick}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div
                aria-hidden="true"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: stat.color,
                  color: stat.iconColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  flexShrink: 0,
                }}
              >
                {stat.icon}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    letterSpacing: '-0.02em',
                    color: stat.trendUp === false ? COLORS.danger : undefined,
                  }}
                >
                  {stat.value.toLocaleString()}
                </div>
                <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
                  {t(stat.labelKey)}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    marginTop: 4,
                    color:
                      stat.trendUp === true
                        ? COLORS.success
                        : stat.trendUp === false
                          ? COLORS.danger
                          : COLORS.textSecondary,
                  }}
                >
                  {stat.trendParams != null
                    ? t(stat.trendKey, stat.trendParams)
                    : t(stat.trendKey)}
                </div>
              </div>
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
}
