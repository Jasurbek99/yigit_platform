import { useState, type CSSProperties } from 'react';
import { Button, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IExternalTrip } from '@/types/externalTrip';
import { TripCardDetails } from './TripCardDetails';
import { boardCardStyle, hasVisaFor, rejectionFailed, syncAgeMinutes } from './truckBoardHelpers';
import { useTripMessages } from './useTripMessages';

const { Text } = Typography;
// A long reason must not stretch the card: cut it, full text in the tooltip.
const REJECTED_TAG_STYLE: CSSProperties = {
  maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block',
};

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
  const messages = useTripMessages();
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
          <Tooltip title={trip.rejection_reason}>
            <Tag color="red" style={REJECTED_TAG_STYLE}>
              {t('truck_board.rejected_tag', { reason: trip.rejection_reason })}
            </Tag>
          </Tooltip>
        )}
      </div>
      {rejectionFailed(trip) && (
        <Text type="danger" style={{ fontSize: 12 }}>{messages.pushError(trip.last_push_error ?? '')}</Text>
      )}
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
