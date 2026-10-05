import { useTranslation } from 'react-i18next';

import type { IDocumentOptions } from '@/components/DocumentOptionsModal';
import { FillPackingButton } from '@/components/FillPackingButton';
import { TirCarnetButton } from '@/components/TirCarnetButton';
import { DocumentDownloadRow } from '@/components/shipment/DocumentDownloadRow';
import { DocumentGroup } from '@/components/shipment/DocumentGroup';
import { DocumentRowShell } from '@/components/shipment/DocumentRowShell';
import { WORD_PDF, WORD_PDF_EXCEL, bilingualFormats, documentFormats } from '@/components/shipment/shipmentDocsUrls';
import type { IDocumentPacket } from '@/types';

interface IShipmentDocsTruckGroupProps {
  readonly packet: IDocumentPacket;
  readonly options: IDocumentOptions;
}

/**
 * Whole-truck documents: the packet ZIP and the CMR in both languages, plus the
 * TIR carnet, which keeps its own modal (driver passports and the CMR № live
 * nowhere in the database). All wait for the truck to be ready — each prints
 * the whole-truck box count and weights. A download closes the print task.
 */
export function ShipmentDocsTruckGroup({ packet, options }: IShipmentDocsTruckGroupProps) {
  const { t } = useTranslation();
  const base = `/contracts/shipments/${packet.id}`;
  const notReady = packet.is_ready ? null : t('shipment_detail.docs.not_ready');
  // The ZIP carries the invoices, which print the loading point; the CMR's box 4 is fixed.
  const zipHint = notReady ?? (options.placeLoading ? null : t('shipment_detail.docs.need_place_loading'));

  return (
    <DocumentGroup
      title={t('shipment_detail.docs.group_truck')}
      extra={!packet.packing_complete && <FillPackingButton shipmentId={packet.id} />}
    >
      <DocumentDownloadRow
        label={t('shipment_detail.docs.packet_zip')}
        formats={bilingualFormats((lang) => ({ lang }), (query) => documentFormats(`${base}/packet.zip`, query, WORD_PDF, options, t))}
        hint={zipHint}
      />
      <DocumentDownloadRow
        label={t('documents.cmr')}
        formats={bilingualFormats((lang) => ({ lang }), (query) => documentFormats(`${base}/cmr/`, query, WORD_PDF_EXCEL, options, t))}
        hint={notReady}
      />
      <DocumentRowShell label={t('documents.tir')} hint={notReady}>
        <TirCarnetButton shipmentId={packet.id} disabled={!packet.is_ready} />
      </DocumentRowShell>
    </DocumentGroup>
  );
}
