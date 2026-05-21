import { Alert, Button, Col, Row, Spin, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';
import { DashboardStatCards } from '@/components/dashboard/DashboardStatCards';
import { DashboardAlertsPanel } from '@/components/dashboard/DashboardAlerts';
import { DashboardRoutes } from '@/components/dashboard/DashboardRoutes';
import { DashboardActiveShipments } from '@/components/dashboard/DashboardActiveShipments';

const { Text, Title } = Typography;

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data, isLoading, isError } = useDashboardSummary();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: 300, gap: 12 }}>
        <Spin size="large" />
        <Text type="secondary">{t('dashboard.loading')}</Text>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('dashboard.load_error')}
        style={{ margin: '24px 0' }}
      />
    );
  }

  return (
    <div>
      <Space
        style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}
      >
        <div>
          <Title level={4} style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {t('dashboard.title')}
          </Title>
          <Text type="secondary">{t('dashboard.subtitle')}</Text>
        </div>
        <Space size="small">
          <Button>{t('dashboard.btn_export_excel')}</Button>
          <Button type="primary" onClick={() => navigate('/export/shipments')}>
            {t('dashboard.btn_new_shipment')}
          </Button>
        </Space>
      </Space>

      <DashboardStatCards stats={data.stats} />

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <DashboardAlertsPanel alerts={data.alerts} />
        </Col>
        <Col xs={24} lg={12}>
          <DashboardRoutes routes={data.routes} />
        </Col>
      </Row>

      <DashboardActiveShipments shipments={data.active_shipments} />
    </div>
  );
}
