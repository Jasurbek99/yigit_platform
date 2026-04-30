import { Card, Tag, Tooltip, Typography } from 'antd';
import { ClockCircleOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusTag } from '@/components/StatusTag';
import { FreshnessPill } from '@/components/FreshnessPill';
import { COLORS, FONT } from '@/constants/styles';
import type { IShipmentListItem } from '@/types';

const { Text } = Typography;

interface IShipmentCardAntProps {
  shipment: IShipmentListItem;
  onEdit?: () => void;
}

/**
 * Ant Design-based shipment card for the Shipments List "cards" view.
 * Click → navigate to detail. Edit icon → call `onEdit` (opens drawer).
 *
 * Distinct from the Mantine-based Kanban card — keeps List free of Mantine.
 */
export function ShipmentCardAnt({ shipment, onEdit }: IShipmentCardAntProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const days = dayjs().diff(dayjs(shipment.updated_at), 'day');

  return (
    <Card
      hoverable
      onClick={() => navigate(`/shipments/${shipment.id}`)}
      style={{ cursor: 'pointer', height: '100%' }}
      bodyStyle={{ padding: 14 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <Text strong style={{ fontFamily: FONT.mono, color: COLORS.primary, fontSize: 14 }}>
          {shipment.cargo_code}
        </Text>
        {onEdit && (
          <Tooltip title={t('common.edit')}>
            <EditOutlined
              style={{ fontSize: 14, color: COLORS.textSecondary, cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            />
          </Tooltip>
        )}
      </div>

      <div style={{ marginTop: 6, fontSize: 12, color: COLORS.textSecondary }}>
        {shipment.customer_name ?? '—'}
        {shipment.country_name ? ` → ${shipment.country_name}` : ''}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <StatusTag statusDisplay={shipment.status_display} />
        <FreshnessPill freshness={shipment.freshness} ageDays={shipment.harvest_age_days} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        {shipment.weight_net != null ? (
          <Text style={{ fontFamily: FONT.mono, fontSize: 13 }}>
            {Number(shipment.weight_net).toLocaleString()} kg
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        )}
        <Text type="secondary" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
          <ClockCircleOutlined />
          {t('kanban.days_stuck', { count: days })}
        </Text>
      </div>

      {shipment.is_gapy_satys && (
        <Tag color="purple" style={{ marginTop: 8, fontSize: 11 }}>Gapy Satys</Tag>
      )}
    </Card>
  );
}
