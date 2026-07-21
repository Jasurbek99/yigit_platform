import { Flex } from 'antd';
import { useTranslation } from 'react-i18next';
import { ShipmentStageCard } from '@/components/shipment/ShipmentStageCard';
import { ShipmentFieldGroup, countMissing } from '@/components/shipment/ShipmentFieldGroup';
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

/**
 * The five always-open stage cards (Destination, Documents, Loading,
 * Transit, Notes) plus the route rail — desktop only.
 *
 * Cards live in their own content-sized 2-col grid; the route rail is a
 * fixed-width sidebar next to it, NOT a third grid column. The rail has
 * 13 lifecycle steps and is much taller than any single card — sharing one
 * grid with it previously forced every row track to stretch to the rail's
 * height, leaving a large empty gap under each short card.
 *
 * Mobile renders the rail full-width above this component instead (see
 * ShipmentDetail.tsx) — `isDesktop` here only toggles the 2-col grid and
 * whether the sidebar rail renders at all.
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

  return (
    <Flex gap={16} align="flex-start" style={{ marginBottom: 16 }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'grid',
          gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <ShipmentStageCard
          title={t('shipment.detail.stage.destination')}
          missingCount={countMissing('logistics', missingKeys)}
          isFutureStage={false}
        >
          <ShipmentFieldGroup {...groupProps} groupKey="logistics" />
        </ShipmentStageCard>

        <ShipmentStageCard
          title={t('shipment.detail.stage.documents')}
          missingCount={countMissing('status', missingKeys)}
          isFutureStage={false}
        >
          <ShipmentDocumentsBody {...groupProps} canEditQuality={canEditAnyField} />
        </ShipmentStageCard>

        <ShipmentStageCard
          title={t('shipment.detail.stage.loading')}
          missingCount={countMissing('goods', missingKeys)}
          isFutureStage={false}
        >
          <ShipmentGoodsBody {...groupProps} canOverrideVariety={canOverrideVariety} />
        </ShipmentStageCard>

        <ShipmentStageCard
          title={t('shipment.detail.stage.transit')}
          missingCount={countMissing('transport', missingKeys)}
          isFutureStage={false}
        >
          <ShipmentFieldGroup {...groupProps} groupKey="transport" />
        </ShipmentStageCard>

        <ShipmentStageCard
          title={t('shipment_edit_drawer.section_notes')}
          missingCount={countMissing('notes', missingKeys)}
          isFutureStage={false}
        >
          <ShipmentFieldGroup {...groupProps} groupKey="notes" />
        </ShipmentStageCard>
      </div>

      {isDesktop && (
        <div style={{ width: 320, flexShrink: 0 }}>
          <RouteTimelineRail shipment={shipment} />
        </div>
      )}
    </Flex>
  );
}
