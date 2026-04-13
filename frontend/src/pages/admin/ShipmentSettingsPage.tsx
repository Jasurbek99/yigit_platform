import { Tabs, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import StatusesTab from './shipment-settings/StatusesTab';
import BorderPointsTab from './shipment-settings/BorderPointsTab';
import OptionListsTab from './shipment-settings/OptionListsTab';

const { Title, Text } = Typography;

export default function ShipmentSettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canWrite = canDo(user, 'shipment', 'edit');

  const tabs = [
    {
      key: 'statuses',
      label: t('shipment_settings.tab_statuses'),
      children: <StatusesTab canWrite={canWrite} />,
    },
    {
      key: 'border_points',
      label: t('shipment_settings.tab_border_points'),
      children: <BorderPointsTab canWrite={canWrite} />,
    },
    {
      key: 'options',
      label: t('shipment_settings.tab_options'),
      children: <OptionListsTab canWrite={canWrite} />,
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          {t('shipment_settings.title')}
        </Title>
        <Text type="secondary">{t('shipment_settings.subtitle')}</Text>
      </div>
      <Tabs items={tabs} destroyInactiveTabPane={false} />
    </div>
  );
}
