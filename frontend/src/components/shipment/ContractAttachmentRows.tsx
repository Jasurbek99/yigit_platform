import { DocumentFileRow } from '@/components/shipment/DocumentFileRow';
import { contractAttachmentUrl, useContract } from '@/hooks/useContracts';

interface IContractAttachmentRowsProps {
  readonly contractId: number;
}

/** The contract's uploaded files (signed scans etc.), uploaded on Contract Detail. */
export function ContractAttachmentRows({ contractId }: IContractAttachmentRowsProps) {
  const { data: contract } = useContract(contractId);
  return (
    <>
      {(contract?.attachments ?? []).map((attachment) => (
        <DocumentFileRow
          key={attachment.id}
          label={attachment.original_filename}
          href={contractAttachmentUrl(contractId, attachment.id)}
          filename={attachment.original_filename}
        />
      ))}
    </>
  );
}
