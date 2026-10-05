import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';

import { ContractAgreementButton } from '@/components/ContractAgreementButton';
import type { IDocumentOptions } from '@/components/DocumentOptionsModal';
import { LinkContractButton } from '@/components/LinkContractButton';
import { ContractAttachmentRows } from '@/components/shipment/ContractAttachmentRows';
import { DocumentDownloadRow } from '@/components/shipment/DocumentDownloadRow';
import { DocumentGroup } from '@/components/shipment/DocumentGroup';
import { DocumentRowShell } from '@/components/shipment/DocumentRowShell';
import { WORD_PDF, documentFormats } from '@/components/shipment/shipmentDocsUrls';
import type { IDocumentPacket, IDocumentPacketFirm } from '@/types';
import type { ILinkedContract } from '@/types/contract';

/** The firm's contract, when the viewer holds the `contract` grant. */
export interface IFirmContractInfo {
  readonly linked: ILinkedContract;
  readonly templateSupported: boolean;
  readonly buyerDirector: string;
}

interface IShipmentDocsFirmGroupProps {
  readonly packet: IDocumentPacket;
  readonly firm: IDocumentPacketFirm;
  readonly options: IDocumentOptions;
  readonly contract: IFirmContractInfo | null;
}

const INVOICES = [{ type: 'invoice_ru', lang: 'RU' }, { type: 'invoice_en', lang: 'EN' }] as const;
const LETTERS = [
  { type: 'ct1_ru', labelKey: 'documents.ct1' },
  { type: 'fito_ru', labelKey: 'documents.fito' },
  { type: 'customs_tk', labelKey: 'documents.customs' },
] as const;

/**
 * One export firm's documents: its contract (which keeps its own modal — seals,
 * buyer director, deadline), the invoice in both languages, the CT-1 / FITO /
 * customs letters and the contract's uploaded attachments. Before the firm has
 * a contract it offers to link one instead.
 */
export function ShipmentDocsFirmGroup({ packet, firm, options, contract }: IShipmentDocsFirmGroupProps) {
  const { t } = useTranslation();
  const title = contract ? `${firm.export_firm_name} · ${contract.linked.contract_number}` : firm.export_firm_name;

  if (firm.sale_id === null) {
    return (
      <DocumentGroup title={title}>
        <div style={{ paddingTop: 6 }}><LinkContractButton shipmentId={packet.id} /></div>
      </DocumentGroup>
    );
  }

  const base = `/contracts/sales/${firm.sale_id}/document/`;
  const noPacking = packet.packing_complete ? null : t('shipment_detail.docs.need_packing');
  const invoiceHint = noPacking ?? (options.placeLoading ? null : t('shipment_detail.docs.need_place_loading'));
  // The invoice takes the loading point; the letters take only the highlight toggle.
  const invoiceOptions: IDocumentOptions = { placeLoading: options.placeLoading, highlight: options.highlight };
  const letterOptions: IDocumentOptions = { highlight: options.highlight };

  return (
    <DocumentGroup title={title}>
      {contract && (
        <DocumentRowShell label={t('shipment_detail.docs.contract')}>
          {contract.templateSupported ? (
            <ContractAgreementButton size="small" contractId={contract.linked.contract_id} defaultDirector={contract.buyerDirector} />
          ) : (
            <Tooltip title={t('contracts.generate.country_unsupported')}>
              <span style={{ display: 'inline-block', cursor: 'not-allowed' }}>
                <ContractAgreementButton size="small" contractId={contract.linked.contract_id} disabled />
              </span>
            </Tooltip>
          )}
        </DocumentRowShell>
      )}
      {INVOICES.map(({ type, lang }) => (
        <DocumentDownloadRow key={type} label={`${t('documents.invoice')} ${lang}`} hint={invoiceHint}
          formats={documentFormats(base, { type }, WORD_PDF, invoiceOptions, t)} />
      ))}
      {LETTERS.map(({ type, labelKey }) => (
        <DocumentDownloadRow key={type} label={t(labelKey)} hint={noPacking}
          formats={documentFormats(base, { type }, WORD_PDF, letterOptions, t)} />
      ))}
      {contract && <ContractAttachmentRows contractId={contract.linked.contract_id} />}
    </DocumentGroup>
  );
}
