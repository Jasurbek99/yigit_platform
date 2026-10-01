import { useEffect, useRef } from 'react';
import { Card, Empty, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { DocumentPacketPanel } from '@/components/DocumentPacketPanel';
import { useShipmentDocumentPacket } from '@/hooks/useDocumentPackets';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { jumpToSection } from '@/pages/export/ShipmentDetailHelpers.helpers';

interface IShipmentDocumentsPrintCardProps {
  shipmentId: number;
  /** Export firms on the truck — no firm means no packet yet. */
  firmCount: number;
  /** The detail's updated_at — any save on the page may change the packet's readiness. */
  shipmentUpdatedAt: string;
}

/**
 * The truck's whole document packet — readiness banner, ZIP, CMR, TIR carnet
 * and each export firm's invoice / letters — viewed and printed from the
 * shipment page without opening Documents (spec 2026-09-30 §3a). Same panel
 * as a Documents-page row. The endpoint is gated by the 'sale' resource, so
 * the card is hidden (and nothing is fetched) for roles without it. The
 * packet lookup is scoped to the season picked in the header: a truck with
 * firms but no packet back is from another season, and the card stays out
 * rather than claim a firm is missing.
 */
export function ShipmentDocumentsPrintCard({
  shipmentId, firmCount, shipmentUpdatedAt,
}: IShipmentDocumentsPrintCardProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const allowed = canDo(user, 'sale', 'view');
  const { data: packet, isLoading, isFetching, refetch } = useShipmentDocumentPacket(allowed ? shipmentId : null);

  // Only the packing / contracts panels invalidate 'document-packets'; a firm
  // pick, a field save or a trip link on this page does not. Refetch when the
  // shipment changes (skipping the first render — the query fetches then anyway).
  const changeKey = `${firmCount}|${shipmentUpdatedAt}`;
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
      title={<span style={{ fontWeight: 600, fontSize: 13 }}>{t('shipment_detail.parts.documents_title')}</span>}
    >
      {isPending ? (
        <Spin style={{ display: 'block', margin: '12px auto' }} />
      ) : packet ? (
        <DocumentPacketPanel packet={packet} onJumpTo={jumpToSection} />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('shipment_detail.parts.documents_no_firm')} />
      )}
    </Card>
  );
}
