import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { IBossAlert } from '@/hooks/useBossDashboard';
import { useBossAlerts } from '@/hooks/useBossDashboard';

function formatRelativeTime(iso: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60)        return t('boss_dashboard.alerts.time_ago.just_now');
  if (seconds < 3600)      return t('boss_dashboard.alerts.time_ago.minutes', { n: Math.floor(seconds / 60) });
  if (seconds < 86_400)    return t('boss_dashboard.alerts.time_ago.hours',   { n: Math.floor(seconds / 3600) });
  return t('boss_dashboard.alerts.time_ago.days', { n: Math.floor(seconds / 86_400) });
}

const { Text } = Typography;

const LEVEL_COLORS: Record<IBossAlert['level'], string> = {
  high: '#ff4d4f',
  med: '#faad14',
  low: '#1677ff',
};

// Keys must match the icon codes returned by `_kind_to_icon()` in
// backend/apps/export/services/boss_analytics.py
const ICON_MAP: Record<string, string> = {
  warning: '⚠️',
  alert: '🚨',
  clock: '⏰',
  bell: '🔔',
  document: '📄',
  check: '✅',
  x: '❌',
  info: 'ℹ️',
};

export function AlertsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useBossAlerts();

  const alerts = data?.rows ?? [];

  return (
    <Card
      size="small"
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.alerts')}</Text>
          {alerts.length > 0 && (
            <span
              style={{
                background: '#ff4d4f',
                color: '#fff',
                borderRadius: 10,
                fontSize: 11,
                padding: '1px 6px',
                fontWeight: 600,
              }}
            >
              {alerts.length}
            </span>
          )}
        </div>
      }
      style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
          {alerts.slice(0, 7).map((alert) => (
            <div
              key={alert.id}
              onClick={() => alert.link && navigate(alert.link)}
              style={{
                borderLeft: `3px solid ${LEVEL_COLORS[alert.level]}`,
                borderRadius: '0 6px 6px 0',
                padding: '8px 10px',
                background: '#fafafa',
                cursor: alert.link ? 'pointer' : 'default',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>
                  {ICON_MAP[alert.icon] ?? ICON_MAP.info}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12, fontWeight: 600, display: 'block' }}>
                    {t(alert.title_key, { defaultValue: alert.kind })}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {alert.body}
                  </Text>
                </div>
                <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                  {formatRelativeTime(alert.created_at, t)}
                </Text>
              </div>
            </div>
          ))}
          {alerts.length === 0 && (
            <Text type="secondary" style={{ fontSize: 13 }}>{t('boss_dashboard.alerts.empty')}</Text>
          )}
        </div>
      )}
    </Card>
  );
}
