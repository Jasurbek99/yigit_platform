import { useTranslation } from 'react-i18next';
import type { ICandidateShipment } from '@/types/externalTrip';
import { COLORS, FONT } from '@/constants/styles';
import { boardCardStyle } from './truckBoardHelpers';

interface IShipmentNeedCardProps {
  shipment: ICandidateShipment;
  selected: boolean;
  onSelect: () => void;
}

export function ShipmentNeedCard({ shipment, selected, onSelect }: IShipmentNeedCardProps) {
  const { t } = useTranslation();
  const firms = shipment.export_firms.map((firm) => firm.name).join(', ');
  return (
    <div
      data-testid={`shipment-card-${shipment.id}`}
      onClick={onSelect}
      style={boardCardStyle(selected)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 12, color: COLORS.primary }}>
          {shipment.shipment_code}
        </span>
        <span style={{ fontSize: 11, color: COLORS.textSecondary }}>{shipment.date}</span>
      </div>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        {shipment.country_name ?? <span style={{ color: COLORS.textTertiary }}>{t('truck_board.no_country')}</span>}
        {shipment.customer_name && <span style={{ color: COLORS.textSecondary }}> · {shipment.customer_name}</span>}
      </div>
      <div style={{ fontSize: 11, marginTop: 4, fontFamily: FONT.mono }}>
        {shipment.export_code ?? <span style={{ color: COLORS.textTertiary }}>{t('truck_board.no_export_code')}</span>}
        <span style={{ color: COLORS.textSecondary, fontFamily: 'inherit' }}>
          {' · '}{t('truck_board.documents_label', {
            status: t(`truck_board.docs.${shipment.documents_status ?? 'none'}`, shipment.documents_status ?? ''),
          })}
        </span>
      </div>
      {(firms || shipment.import_firm_name) && (
        <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 2 }}>
          {firms || '—'} → {shipment.import_firm_name ?? '—'}
        </div>
      )}
      {(shipment.loading_location_name || shipment.city_name) && (
        <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 2 }}>
          📍 {shipment.loading_location_name ?? '—'} → {shipment.city_name ?? '—'}
        </div>
      )}
      {shipment.blocks.length > 0 && (
        <div style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 2 }}>{shipment.blocks.join(', ')}</div>
      )}
    </div>
  );
}
