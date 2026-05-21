import { Alert, Card, Space, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IDashboardAlerts } from '@/hooks/useDashboardSummary';

interface IDashboardAlertsProps {
  alerts: IDashboardAlerts;
}

export function DashboardAlertsPanel({ alerts }: IDashboardAlertsProps) {
  const { t } = useTranslation();

  const visibleAlerts: React.ReactNode[] = [];

  if (alerts.no_report_count > 0) {
    visibleAlerts.push(
      <Alert
        key="no_report"
        type="error"
        message={<strong>{t('dashboard.alert_no_report', { count: alerts.no_report_count })}</strong>}
      />,
    );
  }

  if (alerts.quota_exceeded_count > 0) {
    visibleAlerts.push(
      <Alert
        key="quota_exceeded"
        type="warning"
        message={<strong>{t('dashboard.alert_quota_exceeded')}</strong>}
      />,
    );
  }

  if (alerts.docs_pending_count > 0) {
    visibleAlerts.push(
      <Alert
        key="docs_pending"
        type="warning"
        message={<strong>{t('dashboard.alert_doc_deadline', { count: alerts.docs_pending_count })}</strong>}
      />,
    );
  }

  if (alerts.weekly_plan != null) {
    visibleAlerts.push(
      <Alert
        key="weekly_plan"
        type="info"
        message={
          <strong>
            {t('dashboard.alert_weekly_plan', {
              week: alerts.weekly_plan.week,
              tons: alerts.weekly_plan.tons,
              blocks: alerts.weekly_plan.blocks,
            })}
          </strong>
        }
      />,
    );
  }

  return (
    <Card style={{ borderRadius: 12, height: '100%' }} styles={{ body: { padding: 16 } }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 600 }}>⚡ {t('dashboard.alerts_title')}</span>
        <Tag color="red">{visibleAlerts.length}</Tag>
      </Space>
      {visibleAlerts.length > 0 ? (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {visibleAlerts}
        </Space>
      ) : (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#8c8c8c', fontSize: 13 }}>
          {t('dashboard.alerts_empty')}
        </div>
      )}
    </Card>
  );
}
