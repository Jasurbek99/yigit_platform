import { useTranslation } from 'react-i18next';
import type { ICandidateShipment } from '@/types/externalTrip';
import { COLORS, FONT } from '@/constants/styles';

interface IShipmentNeedCardProps {
  shipment: ICandidateShipment;
  selected: boolean;
  onSelect: () => void;
}

export function ShipmentNeedCard({ shipment, selected, onSelect }: IShipmentNeedCardProps) {
  const { t } = useTranslation();
  return (
    <div
      data-testid={`shipment-card-${shipment.id}`}
      onClick={onSelect}
      style={{
        background: selected ? COLORS.bgBlue : '#fff',
        border: selected ? '2px solid #1677ff' : '1px solid #f0f0f0',
        borderRadius: 6,
        padding: 10,
        marginBottom: 8,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 12, color: COLORS.primary }}>
          {shipment.code}
        </span>
        <span style={{ fontSize: 11, color: COLORS.textSecondary }}>{shipment.date}</span>
      </div>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        {shipment.country_name ?? <span style={{ color: COLORS.textTertiary }}>{t('truck_board.no_country')}</span>}
        {shipment.customer_name && <span style={{ color: COLORS.textSecondary }}> · {shipment.customer_name}</span>}
      </div>
      {shipment.blocks.length > 0 && (
        <div style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 2 }}>{shipment.blocks.join(', ')}</div>
      )}
    </div>
  );
}
