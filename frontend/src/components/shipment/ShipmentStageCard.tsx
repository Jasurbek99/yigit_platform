import { Card, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

interface IShipmentStageCardProps {
  title: string;
  missingCount: number;
  isFutureStage: boolean;
  children: React.ReactNode;
}

/**
 * One always-open group of fields, named after the journey stage it belongs
 * to (Destination / Documents / Loading / In transit / Sale).
 *
 * Replaces the old collapsing accordion stage: there is no collapse here by
 * design — the page is meant to show everything at once.
 *
 * `isFutureStage` greys the card and swaps the badge for a "not yet" note.
 * Every current caller passes `false`; the page no longer maps phases onto
 * cards (that mapping is what the accordion used). Kept because a stage
 * that has not been reached is a real state the design calls for, and the
 * card is the right place to express it if a later task reintroduces it.
 */
export function ShipmentStageCard({
  title,
  missingCount,
  isFutureStage,
  children,
}: IShipmentStageCardProps) {
  const { t } = useTranslation();

  return (
    <Card
      size="small"
      style={{ opacity: isFutureStage ? 0.65 : 1 }}
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text strong style={{ fontSize: 13 }}>{title}</Text>
          {isFutureStage ? (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('shipment.detail.stage_not_reached')}
            </Text>
          ) : missingCount > 0 ? (
            <Tag color="warning" style={{ fontSize: 10, margin: 0 }}>
              {t('shipment.detail.stage_missing', { count: missingCount })}
            </Tag>
          ) : (
            <Tag color="success" style={{ fontSize: 10, margin: 0 }}>
              {t('shipment.detail.stage_complete')}
            </Tag>
          )}
        </div>
      }
      styles={{ body: { padding: '4px 12px' } }}
    >
      {children}
    </Card>
  );
}
