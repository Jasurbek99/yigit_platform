import { useEffect, useRef, useState } from 'react';
import { Card, Empty, Spin } from 'antd';
import { useTranslation } from 'react-i18next';

import type { IDocumentOptions } from '@/components/DocumentOptionsModal';
import { PacketSetupAlert } from '@/components/PacketSetupAlert';
import { ShipmentDocsFirms } from '@/components/shipment/ShipmentDocsFirms';
import { ShipmentDocsOptionsBar } from '@/components/shipment/ShipmentDocsOptionsBar';
import { ShipmentDocsOtherGroup } from '@/components/shipment/ShipmentDocsOtherGroup';
import { ShipmentDocsTruckGroup } from '@/components/shipment/ShipmentDocsTruckGroup';
import { useLoadingLocations } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useShipmentDocumentPacket } from '@/hooks/useDocumentPackets';
import { jumpToSection } from '@/pages/export/ShipmentDetailHelpers.helpers';
import type { IShipmentDetail } from '@/types';
import { canDo } from '@/utils/permissions';

interface IShipmentDocumentsCardProps {
  readonly shipment: IShipmentDetail;
}

/**
 * Every document of the shipment in one flat list — each one its own row,
 * downloaded in one click (spec 2026-10-05). The loading point, TIR carnet №
 * and highlight that a modal used to ask per download are set once in the top
 * bar; the loading point starts from the shipment's own. Only the TIR carnet
 * and the contract keep their modals: they ask for data stored nowhere else.
 *
 * The packet endpoint is gated by the 'sale' resource, so the card is hidden
 * (and nothing is fetched) for roles without it. The packet lookup is scoped to
 * the season picked in the header: a truck with firms but no packet back is
 * from another season, and the card stays out rather than claim a firm is missing.
 */
export function ShipmentDocumentsCard({ shipment }: IShipmentDocumentsCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const allowed = canDo(user, 'sale', 'view');
  const { data: packet, isLoading, isFetching, refetch } = useShipmentDocumentPacket(allowed ? shipment.id : null);
  const { data: locations = [] } = useLoadingLocations();
  const [optionEdits, setOptionEdits] = useState<Partial<IDocumentOptions>>({});

  const firmCount = shipment.firm_splits.length;
  const defaultPlace = locations.find((loc) => loc.id === shipment.loading_location)?.name ?? '';
  const options: IDocumentOptions = { placeLoading: defaultPlace, tirCarnet: '', highlight: true, ...optionEdits };

  const handleOptionsChange = (patch: Partial<IDocumentOptions>): void => {
    setOptionEdits((prev) => ({ ...prev, ...patch }));
  };

  // Only the packing / contracts panels invalidate 'document-packets'; a firm
  // pick, a field save or a trip link on this page does not. Refetch when the
  // shipment changes (skipping the first render — the query fetches then anyway).
  const changeKey = `${firmCount}|${shipment.updated_at}`;
  const seenKey = useRef(changeKey);
  useEffect(() => {
    if (seenKey.current === changeKey) return;
    seenKey.current = changeKey;
    if (allowed) void refetch();
  }, [changeKey, allowed, refetch]);

  if (!allowed) return null;
  const isPending = isLoading || (isFetching && !packet);
  if (!isPending && !packet && firmCount > 0) return null;

  return (
    <Card
      id="section-documents-print"
      size="small"
      style={{ marginBottom: 16 }}
      title={<span style={{ fontWeight: 600, fontSize: 13 }}>{t('shipment_detail.docs.title')}</span>}
    >
      {isPending ? (
        <Spin style={{ display: 'block', margin: '12px auto' }} />
      ) : (
        <>
          {packet ? (
            <>
              <PacketSetupAlert packet={packet} onJumpTo={jumpToSection} />
              <ShipmentDocsOptionsBar options={options} onChange={handleOptionsChange} />
              <ShipmentDocsTruckGroup packet={packet} options={options} />
              <ShipmentDocsFirms packet={packet} options={options} />
            </>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('shipment_detail.parts.documents_no_firm')} />
          )}
          <ShipmentDocsOtherGroup shipment={shipment} />
        </>
      )}
    </Card>
  );
}
