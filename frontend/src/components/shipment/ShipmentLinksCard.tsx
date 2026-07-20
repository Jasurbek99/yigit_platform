import { Card, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';

/**
 * External-system integration status for this shipment (Logo Tiger, Trip
 * Management, GPS). Placeholder states only — none of these integrations is
 * wired up yet, so the card reports "not sent" / "no device" statically.
 */
export function ShipmentLinksCard() {
  const { t } = useTranslation();

  const rows: [string, React.ReactNode][] = [
    ['Logo Tiger', <Tag key="logo">{t('shipment_detail.link_not_sent')}</Tag>],
    ['Trip Management', <span key="trip" style={{ color: COLORS.textSecondary }}>—</span>],
    ['GPS Tracking', <Tag key="gps">{t('shipment_detail.link_no_device')}</Tag>],
  ];

  return (
    <Card title={`🔗 ${t('shipment_detail.links_card')}`} size="small">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: COLORS.textSecondary }}>{label}</span>
            {value}
          </div>
        ))}
      </div>
    </Card>
  );
}
