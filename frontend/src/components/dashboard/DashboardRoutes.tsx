import { Card, Progress, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';
import type { IDashboardRoute } from '@/hooks/useDashboardSummary';

interface IDashboardRoutesProps {
  routes: IDashboardRoute[];
}

// Flag lookup by country_name as returned by the backend.
// Backend country names must match these keys exactly.
const COUNTRY_FLAGS: Record<string, string> = {
  Kazakhstan: '🇰🇿',
  Russia: '🇷🇺',
  Uzbekistan: '🇺🇿',
  Belarus: '🇧🇾',
  Kyrgyzstan: '🇰🇬',
};

const DEFAULT_FLAG = '🌍';

const ROUTE_COLORS = [
  COLORS.primary,
  COLORS.success,
  COLORS.warning,
  COLORS.danger,
  COLORS.purple,
  '#13c2c2',
];

function buildCityString(cities: IDashboardRoute['cities']): string {
  if (!cities || cities.length === 0) return '';
  return cities.map((c) => `${c.city}: ${c.trucks}`).join(' · ');
}

export function DashboardRoutes({ routes }: IDashboardRoutesProps) {
  const { t } = useTranslation();

  return (
    <Card style={{ borderRadius: 12, height: '100%' }} styles={{ body: { padding: 16 } }}>
      <span style={{ fontWeight: 600, display: 'block', marginBottom: 16 }}>
        📊 {t('dashboard.routes_title')}
      </span>
      {routes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#8c8c8c', fontSize: 13 }}>
          {t('dashboard.no_data')}
        </div>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {routes.map((route, i) => {
            const flag = COUNTRY_FLAGS[route.country_name] ?? DEFAULT_FLAG;
            const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
            const sub = buildCityString(route.cities);

            return (
              <div key={route.country_id}>
                <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {flag} {route.country_name}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {route.trucks} {t('dashboard.shipment_suffix')}
                  </span>
                </Space>
                <Progress percent={route.percent} size="small" strokeColor={color} showInfo={false} />
                {sub && (
                  <span style={{ fontSize: 12, color: COLORS.textSecondary }}>
                    {sub}
                  </span>
                )}
              </div>
            );
          })}
        </Space>
      )}
    </Card>
  );
}
