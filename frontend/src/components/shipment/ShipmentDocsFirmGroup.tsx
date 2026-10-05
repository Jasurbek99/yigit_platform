import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';

import { ContractAgreementButton } from '@/components/ContractAgreementButton';
import type { IDocumentOptions } from '@/components/DocumentOptionsModal';
import { LinkContractButton } from '@/components/LinkContractButton';
import { ContractAttachmentRows } from '@/components/shipment/ContractAttachmentRows';
import { DocumentDownloadRow } from '@/components/shipment/DocumentDownloadRow';
import { DocumentGroup } from '@/components/shipment/DocumentGroup';
import { DocumentRowShell } from '@/components/shipment/DocumentRowShell';
import { LetterNumberEdit } from '@/components/shipment/LetterNumberEdit';
import { WORD_PDF, bilingualFormats, documentFormats } from '@/components/shipment/shipmentDocsUrls';
import { useAuth } from '@/hooks/useAuth';
import type { IDocumentPacket, IDocumentPacketFirm } from '@/types';
import type { ILinkedContract } from '@/types/contract';
import { canDo } from '@/utils/permissions';

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

const LETTERS = [
  { type: 'ct1_ru', labelKey: 'documents.ct1', field: 'ct1_number' },
  { type: 'fito_ru', labelKey: 'documents.fito', field: 'fito_number' },
  { type: 'customs_tk', labelKey: 'documents.customs', field: 'customs_number' },
] as const;

/**
 * One export firm's documents: its contract (which keeps its own modal — seals,
 * buyer director, deadline), the invoice in both languages, the CT-1 / FITO /
 * customs letters and the contract's uploaded attachments. Before the firm has
 * a contract it offers to link one instead.
 */
export function ShipmentDocsFirmGroup({ packet, firm, options, contract }: IShipmentDocsFirmGroupProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
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
      <DocumentDownloadRow label={t('documents.invoice')} hint={invoiceHint}
        formats={bilingualFormats((lang) => ({ type: `invoice_${lang}` }), (query) => documentFormats(base, query, WORD_PDF, invoiceOptions, t))} />
      {LETTERS.map(({ type, labelKey, field }) => (
        <DocumentDownloadRow key={type} hint={noPacking}
          label={<>{t(labelKey)} <LetterNumberEdit saleId={firm.sale_id!} field={field} value={firm[field]} canEdit={canDo(user, 'sale', 'edit')} /></>}
          formats={documentFormats(base, { type }, WORD_PDF, letterOptions, t)} />
      ))}
      {contract && <ContractAttachmentRows contractId={contract.linked.contract_id} />}
    </DocumentGroup>
  );
}
