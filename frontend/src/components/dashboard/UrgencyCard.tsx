import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IShipmentListItem } from '@/types';

const COUNTRY_FLAGS: Record<string, string> = {
  KZ: '🇰🇿',
  RU: '🇷🇺',
  BY: '🇧🇾',
  KG: '🇰🇬',
};

interface IUrgencyCardProps {
  icon: string;
  titleKey: string;
  items: IShipmentListItem[];
  color: string;
  bgColor: string;
  borderColor: string;
  onSelect: (id: number) => void;
}

export function UrgencyCard({
  icon,
  titleKey,
  items,
  color,
  bgColor,
  borderColor,
  onSelect,
}: IUrgencyCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const handleToggle = () => setOpen((prev) => !prev);

  return (
    <div
      className="urgency-card"
      style={{ border: `1px solid ${borderColor}` }}
    >
      <div
        className="urgency-card-header"
        onClick={handleToggle}
        style={{ borderLeft: `4px solid ${color}` }}
        role="button"
        aria-expanded={open}
      >
        <span style={{ fontSize: 22 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#344054' }}>
            {t(titleKey)}
          </div>
          <div style={{ fontSize: 10, color: '#667085', marginTop: 1 }}>
            {t('dashboard.shipments_count', { count: items.length })}
          </div>
        </div>
        <div className="urgency-card-count" style={{ color }}>
          {items.length}
        </div>
        <span
          className={`urgency-card-chevron${open ? ' urgency-card-chevron--open' : ''}`}
        >
          ▼
        </span>
      </div>

      {open && (
        <div
          className="urgency-card-body"
          style={{ borderTop: `1px solid ${borderColor}`, background: bgColor }}
        >
          {items.map((shipment, idx) => (
            <UrgencyItem
              key={shipment.id}
              shipment={shipment}
              color={color}
              borderColor={borderColor}
              isLast={idx === items.length - 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface IUrgencyItemProps {
  shipment: IShipmentListItem;
  color: string;
  borderColor: string;
  isLast: boolean;
  onSelect: (id: number) => void;
}

function UrgencyItem({ shipment, borderColor, isLast, onSelect }: IUrgencyItemProps) {
  const { t } = useTranslation();

  const countryCode = shipment.country_name?.slice(0, 2).toUpperCase() ?? '';
  const flag = COUNTRY_FLAGS[countryCode] ?? '';
  const weightTons = shipment.weight_net
    ? (shipment.weight_net / 1000).toFixed(1)
    : '—';

  return (
    <div
      className="urgency-item"
      onClick={() => onSelect(shipment.id)}
      style={{
        borderBottom: isLast ? 'none' : `1px solid ${borderColor}`,
      }}
    >
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700,
          color: '#175cd3',
          width: 100,
          flexShrink: 0,
          fontSize: 11,
        }}
      >
        {shipment.cargo_code}
      </span>
      <span style={{ color: '#475467', flex: 1, fontSize: 11 }}>
        {shipment.customer_name} → {flag} {shipment.country_name}
      </span>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
          color: '#344054',
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        {weightTons}t
      </span>
      {shipment.status_step >= 11 && !shipment.arrived_at && (
        <span
          style={{
            background: '#fef3f2',
            color: '#b42318',
            padding: '1px 8px',
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {t('dashboard.overdue_days', { days: 0 })}
        </span>
      )}
    </div>
  );
}
