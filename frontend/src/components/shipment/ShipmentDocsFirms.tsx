import type { IDocumentOptions } from '@/components/DocumentOptionsModal';
import { ShipmentDocsFirmGroup, type IFirmContractInfo } from '@/components/shipment/ShipmentDocsFirmGroup';
import { useAuth } from '@/hooks/useAuth';
import { useShipmentFirmContracts } from '@/hooks/useShipmentFirmContracts';
import type { IDocumentPacket } from '@/types';
import { canDo } from '@/utils/permissions';

interface IShipmentDocsFirmsProps {
  readonly packet: IDocumentPacket;
  readonly options: IDocumentOptions;
}

/**
 * A document group per export firm. The firm → contract map comes from the
 * `sale`-gated firm-contracts lookup (the card is already `sale`-gated); the
 * contract itself and its attachments need the `contract` grant on top.
 */
export function ShipmentDocsFirms({ packet, options }: IShipmentDocsFirmsProps) {
  const { user } = useAuth();
  const canContract = canDo(user, 'contract', 'view');
  const { data } = useShipmentFirmContracts(packet.id, canContract);

  const contractOf = (firmId: number): IFirmContractInfo | null => {
    const linked = data?.rows.find((row) => row.export_firm === firmId)?.linked;
    if (!canContract || !data || !linked) return null;
    return {
      linked,
      templateSupported: data.contract_template_supported,
      buyerDirector: data.import_firm_director ?? '',
    };
  };

  return (
    <>
      {packet.firms.map((firm) => (
        <ShipmentDocsFirmGroup
          key={firm.export_firm_id}
          packet={packet}
          firm={firm}
          options={options}
          contract={contractOf(firm.export_firm_id)}
        />
      ))}
    </>
  );
}
