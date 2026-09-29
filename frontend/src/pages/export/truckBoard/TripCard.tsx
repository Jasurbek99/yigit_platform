import { Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IExternalTrip } from '@/types/externalTrip';
import { COLORS } from '@/constants/styles';
import { hasVisaFor } from './truckBoardHelpers';

const { Text } = Typography;

interface ITripCardProps {
  trip: IExternalTrip;
  selected: boolean;
  dimmed?: boolean;
  /** Country of the selected shipment — drives the missing-visa warning. */
  countryCode: string | null;
  onSelect: () => void;
  onOpen: () => void;
}

export function TripCard({ trip, selected, dimmed, countryCode, onSelect, onOpen }: ITripCardProps) {
  const { t } = useTranslation();
  const where = trip.position
    ? trip.position.geofence_name ?? trip.position.address
      ?? `${trip.position.lat.toFixed(3)}, ${trip.position.lon.toFixed(3)}`
    : t('truck_board.no_gps');
  return (
    <div
      data-testid={`trip-card-${trip.id}`}
      onClick={onSelect}
      style={{
        border: selected ? '2px solid #1677ff' : '1px solid #f0f0f0',
        borderRadius: 6,
        padding: 10,
        marginBottom: 8,
        cursor: 'pointer',
        opacity: dimmed ? 0.55 : 1,
        background: selected ? COLORS.bgBlue : '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Text strong>{trip.tractor_plate} / {trip.trailer_plate}</Text>
        <Text type="secondary">{trip.planned_departure}</Text>
      </div>
      <div>{trip.driver_full_name}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
        <Tag>{trip.tractor_source === 'GARAGE' ? t('truck_board.garage') : t('truck_board.third_party')}</Tag>
        {trip.destination_country_code && <Tag color="blue">{trip.destination_country_code}</Tag>}
        {!hasVisaFor(trip, countryCode) && <Tag color="orange">⚠ {t('truck_board.no_visa')}</Tag>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>📍 {where}</Text>
        <a
          style={{ fontSize: 12 }}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {t('truck_board.details')}
        </a>
      </div>
    </div>
  );
}
