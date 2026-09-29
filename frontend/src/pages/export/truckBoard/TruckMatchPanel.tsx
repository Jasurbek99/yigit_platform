import { Alert, Button, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ICandidateShipment, IExternalTrip } from '@/types/externalTrip';

const { Text } = Typography;

interface ITruckMatchPanelProps {
  shipment: ICandidateShipment | null;
  trip: IExternalTrip | null;
  canAssign: boolean;
  isReadOnly: boolean;
  isLoading: boolean;
  onAssign: () => void;
  onClear: () => void;
}

export function TruckMatchPanel({
  shipment, trip, canAssign, isReadOnly, isLoading, onAssign, onClear,
}: ITruckMatchPanelProps) {
  const { t } = useTranslation();
  const mismatch = !!shipment && !!trip && trip.destination_country_code !== null
    && trip.destination_country_code !== shipment.country_code;
  const ready = !!shipment && !!trip && !mismatch && canAssign && !isReadOnly;
  return (
    <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, padding: 14 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Text type="secondary">{t('truck_board.col_shipments')}</Text>
        <Text strong>{shipment ? `${shipment.code} · ${shipment.country_code ?? '—'}` : '—'}</Text>
        <Text type="secondary">{t('truck_board.col_trips')}</Text>
        <Text strong>
          {trip ? `${trip.tractor_plate} / ${trip.trailer_plate} · ${trip.destination_country_code ?? '—'}` : '—'}
        </Text>
        {mismatch && <Alert type="error" showIcon message={t('truck_board.country_mismatch')} />}
        <Space>
          <Button type="primary" disabled={!ready} loading={isLoading} onClick={onAssign}>
            {t('truck_board.assign')}
          </Button>
          <Button onClick={onClear}>{t('truck_board.clear')}</Button>
        </Space>
      </Space>
    </div>
  );
}
