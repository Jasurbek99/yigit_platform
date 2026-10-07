import { useState } from 'react';
import { Button, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IExternalTrip } from '@/types/externalTrip';
import { TripCardDetails } from './TripCardDetails';
import { boardCardStyle, hasVisaFor, syncAgeMinutes } from './truckBoardHelpers';

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
  const [expanded, setExpanded] = useState(false);
  const position = trip.position;
  const place = position
    ? position.geofence_name ?? position.address ?? `${position.lat.toFixed(3)}, ${position.lon.toFixed(3)}`
    : null;
  const age = syncAgeMinutes(position?.fix_time ?? null);
  const where = place
    ? age === null ? place : `${place} · ${t('truck_board.minutes_ago', { minutes: age })}`
    : t('truck_board.no_gps');
  return (
    <div
      data-testid={`trip-card-${trip.id}`}
      onClick={onSelect}
      style={boardCardStyle(selected, dimmed)}
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
        {trip.rejected_at && (
          <Tag color="red">{t('truck_board.rejected_tag', { reason: trip.rejection_reason })}</Tag>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>📍 {where}</Text>
        <span>
          <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? `${t('truck_board.less')} ▴` : `${t('truck_board.more')} ▾`}
          </Button>
          <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
            {t('truck_board.details')}
          </Button>
        </span>
      </div>
      {expanded && <TripCardDetails trip={trip} />}
    </div>
  );
}
