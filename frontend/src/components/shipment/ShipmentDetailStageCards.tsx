import { Fragment } from 'react';
import { Flex } from 'antd';
import { useTranslation } from 'react-i18next';
import { ShipmentStageCard } from '@/components/shipment/ShipmentStageCard';
import { ShipmentFieldGroup, countMissing } from '@/components/shipment/ShipmentFieldGroup';
import { ShipmentDestinationBody } from '@/components/shipment/ShipmentDestinationBody';
import { ShipmentTransportBody } from '@/components/shipment/ShipmentTransportBody';
import { ShipmentQualityBody } from '@/components/shipment/ShipmentQualityBody';
import { ShipmentGoodsBody } from '@/components/shipment/ShipmentGoodsBody';
import { ShipmentDocumentsBody } from '@/components/shipment/ShipmentDocumentsBody';
import { RouteTimelineRail } from '@/components/shipment/RouteTimelineRail';
import type { IShipmentDetail } from '@/types';

interface IShipmentDetailStageCardsProps {
  shipment: IShipmentDetail;
  isDesktop: boolean;
  missingKeys: Set<string>;
  readOnly: boolean;
  onOpenComments: (fieldKey: string) => void;
  commentCountsByField: Record<string, number>;
  canEditAnyField: boolean;
  canOverrideVariety: boolean;
}

const COLUMN_STYLE = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 } as const;

/**
 * The six always-open stage cards (Destination, Transport, Loading, Quality,
 * Notes, Documents) plus the route rail — desktop only.
 *
 * Desktop lays the cards out as TWO INDEPENDENT flex columns, not a 2-col
 * CSS grid. A grid couples the two columns into shared row tracks, so a short
 * card sitting in the same row as a tall one is left with a large empty gap
 * beneath it until the next row. Independent flex columns each stack their
 * own cards at natural height, so no gap. The route rail is a third
 * fixed-width sidebar.
 *
 * Cards are declared once in reading order; desktop splits them across the
 * two columns by even/odd index — left = Destination/Loading/Notes, right =
 * Transport/Documents/Quality — while mobile renders them in the same single
 * column, in that reading order.
 */
export function ShipmentDetailStageCards({
  shipment,
  isDesktop,
  missingKeys,
  readOnly,
  onOpenComments,
  commentCountsByField,
  canEditAnyField,
  canOverrideVariety,
}: IShipmentDetailStageCardsProps) {
  const { t } = useTranslation();
  const groupProps = { shipment, missingKeys, readOnly, onOpenComments, commentCountsByField };

  const cards = [
    <ShipmentStageCard
      key="destination"
      title={t('shipment.detail.stage.destination')}
      missingCount={countMissing('logistics', missingKeys)}
      isFutureStage={false}
    >
      <ShipmentDestinationBody {...groupProps} />
    </ShipmentStageCard>,

    <ShipmentStageCard
      key="transit"
      title={t('shipment.detail.stage.transit')}
      missingCount={countMissing('transport', missingKeys)}
      isFutureStage={false}
    >
      <ShipmentTransportBody {...groupProps} />
    </ShipmentStageCard>,

    <ShipmentStageCard
      key="loading"
      title={t('shipment.detail.stage.loading')}
      missingCount={countMissing('goods', missingKeys)}
      isFutureStage={false}
    >
      <ShipmentGoodsBody {...groupProps} canOverrideVariety={canOverrideVariety} />
    </ShipmentStageCard>,

    <ShipmentStageCard
      key="documents"
      title={t('shipment.detail.stage.documents')}
      missingCount={countMissing('status', missingKeys)}
      isFutureStage={false}
    >
      <ShipmentDocumentsBody {...groupProps} />
    </ShipmentStageCard>,

    <ShipmentStageCard
      key="notes"
      title={t('shipment_edit_drawer.section_notes')}
      missingCount={countMissing('notes', missingKeys)}
      isFutureStage={false}
    >
      <ShipmentFieldGroup {...groupProps} groupKey="notes" />
    </ShipmentStageCard>,

    <ShipmentStageCard
      key="quality"
      title={t('shipment_detail.section_certs')}
      missingCount={0}
      isFutureStage={false}
    >
      <ShipmentQualityBody shipment={shipment} canEditQuality={canEditAnyField} />
    </ShipmentStageCard>,
  ];

  if (!isDesktop) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
        {cards.map((card) => (
          <Fragment key={card.key}>{card}</Fragment>
        ))}
      </div>
    );
  }

  const leftColumn = cards.filter((_, i) => i % 2 === 0);
  const rightColumn = cards.filter((_, i) => i % 2 === 1);

  return (
    <Flex gap={16} align="flex-start" style={{ marginBottom: 16 }}>
      <div style={COLUMN_STYLE}>
        {leftColumn.map((card) => (
          <Fragment key={card.key}>{card}</Fragment>
        ))}
      </div>
      <div style={COLUMN_STYLE}>
        {rightColumn.map((card) => (
          <Fragment key={card.key}>{card}</Fragment>
        ))}
      </div>
      <div style={{ width: 320, flexShrink: 0 }}>
        <RouteTimelineRail shipment={shipment} />
      </div>
    </Flex>
  );
}
