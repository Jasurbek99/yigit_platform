import { Tabs, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import StatusesTab from './shipment-settings/StatusesTab';
import BorderPointsTab from './shipment-settings/BorderPointsTab';
import OptionListsTab from './shipment-settings/OptionListsTab';
import TruckSplitsTab from './shipment-settings/TruckSplitsTab';
import SheetRowsTab from './shipment-settings/SheetRowsTab';

const { Title, Text } = Typography;

export default function ShipmentSettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canWrite = canDo(user, 'shipment', 'edit');
  const canEditTruckSplits = canDo(user, 'truck_split_default', 'edit');

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
    {
      key: 'truck_splits',
      label: t('shipment_settings.tab_truck_splits'),
      children: <TruckSplitsTab canWrite={canEditTruckSplits} />,
    },
    {
      key: 'sheet_rows',
      label: t('shipment_settings.tab_sheet_rows'),
      children: <SheetRowsTab canWrite={canWrite} />,
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
