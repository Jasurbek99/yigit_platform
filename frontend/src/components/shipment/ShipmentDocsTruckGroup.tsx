import { useTranslation } from 'react-i18next';

import type { IDocumentOptions } from '@/components/DocumentOptionsModal';
import { FillPackingButton } from '@/components/FillPackingButton';
import { TirCarnetButton } from '@/components/TirCarnetButton';
import { DocumentDownloadRow } from '@/components/shipment/DocumentDownloadRow';
import { DocumentGroup } from '@/components/shipment/DocumentGroup';
import { DocumentRowShell } from '@/components/shipment/DocumentRowShell';
import { WORD_PDF, WORD_PDF_EXCEL, documentFormats } from '@/components/shipment/shipmentDocsUrls';
import type { IDocumentPacket } from '@/types';

interface IShipmentDocsTruckGroupProps {
  readonly packet: IDocumentPacket;
  readonly options: IDocumentOptions;
}

const LANGS = ['ru', 'en'] as const;

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
  const hint = notReady ?? (options.placeLoading ? null : t('shipment_detail.docs.need_place_loading'));

  return (
    <DocumentGroup
      title={t('shipment_detail.docs.group_truck')}
      extra={!packet.packing_complete && <FillPackingButton shipmentId={packet.id} />}
    >
      {LANGS.map((lang) => (
        <DocumentDownloadRow
          key={`zip-${lang}`}
          label={`${t('shipment_detail.docs.packet_zip')} ${lang.toUpperCase()}`}
          formats={documentFormats(`${base}/packet.zip`, { lang }, WORD_PDF, options, t)}
          hint={hint}
        />
      ))}
      {LANGS.map((lang) => (
        <DocumentDownloadRow
          key={`cmr-${lang}`}
          label={`${t('documents.cmr')} ${lang.toUpperCase()}`}
          formats={documentFormats(`${base}/cmr/`, { lang }, WORD_PDF_EXCEL, options, t)}
          hint={hint}
        />
      ))}
      <DocumentRowShell label={t('documents.tir')} hint={notReady}>
        <TirCarnetButton shipmentId={packet.id} disabled={!packet.is_ready} />
      </DocumentRowShell>
    </DocumentGroup>
  );
}
