import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IShipmentDraft } from '@/types';
import { COLORS, FONT } from '@/constants/styles';
import { CardDetails } from './CardDetails';
import { ExportCode } from './ExportCode';

interface IExportPartCardProps {
  part: IShipmentDraft;
  selected: boolean;
  onSelect: () => void;
}

/** Right-column card: a destination plan before loading, its truck and packing. */
export function ExportPartCard({ part, selected, onSelect }: IExportPartCardProps) {
  const { t } = useTranslation();
  const hasTruck = Boolean(part.truck_plate || part.driver_name);

  return (
    <div
      onClick={onSelect}
      style={{
        background: selected ? COLORS.bgBlue : COLORS.white,
        border: selected ? '2px solid #1677ff' : '1px solid #f0f0f0',
        borderRadius: 6, padding: 10, marginBottom: 8, cursor: 'pointer',
        boxShadow: selected ? '0 0 0 2px rgba(22,119,255,0.2)' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
        <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 12, color: COLORS.primary }}>
          {part.shipment_code}
          {part.export_code && <ExportCode code={part.export_code} />}
        </span>
        <Tag style={{ marginInlineEnd: 0, fontSize: 10 }}>
          {t(`shipment_status.${part.status_code}`, { defaultValue: part.status_display ?? part.status_code })}
        </Tag>
      </div>
      {part.weight_net != null && part.weight_net > 0 && (
        <div style={{ fontFamily: FONT.mono, fontSize: 11, color: '#08979c', marginTop: 2 }}>
          {part.weight_net.toLocaleString('ru-RU')} kg
        </div>
      )}
      <CardDetails draft={part} />
      {!hasTruck && (
        <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 2 }}>
          {t('assign.no_truck')}
        </div>
      )}
    </div>
  );
}
