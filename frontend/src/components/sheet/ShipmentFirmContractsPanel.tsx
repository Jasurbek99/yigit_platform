import { useState } from 'react';
import { Button, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useShipmentFirmContracts,
  useLinkFirmContract,
} from '@/hooks/useShipmentFirmContracts';
import { ContractAgreementButton } from '@/components/ContractAgreementButton';
import { useAuth } from '@/hooks/useAuth';
import { canDo, canSeePage } from '@/utils/permissions';
import type { IShipmentFirmContractRow } from '@/types/contract';

const { Text } = Typography;

interface IShipmentFirmContractsPanelProps {
  readonly shipmentId: number;
  /**
   * Raised while the contract generator's modal is open. The cell renders this
   * panel inside a Popover that dismisses on outside click, and the modal is a
   * portal on document.body — without this the first click into the modal
   * unmounts the Popover and the modal with it.
   */
  readonly onModalOpenChange?: (open: boolean) => void;
}

/**
 * Per-firm contract resolution shown under the Sheet "firms" cell editor.
 * For each firm split: shows the linked contract, or the framework contracts of
 * the (firm, buyer) pair to link, plus a "create one-time" button. The shipment
 * (draft) already exists while the cell is edited, so linking works immediately.
 */
export function ShipmentFirmContractsPanel({
  shipmentId,
  onModalOpenChange,
}: IShipmentFirmContractsPanelProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, isLoading } = useShipmentFirmContracts(shipmentId);
  // Two different gates, because the two affordances go through two different
  // guards: the generator hits an endpoint gated on the `contract` RESOURCE, and
  // the link lands on a route gated on the `contracts.list` PAGE code. An admin
  // can toggle either without the other, and gating both on one would either
  // hide a working button or hand someone a link straight to Unauthorized.
  const canGenerate = canDo(user, 'contract', 'view');
  const canOpenContractPage = canSeePage(user, 'contracts.list');

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ marginTop: 8, padding: 8, background: '#fafafa', borderRadius: 4, minWidth: 280 }}
    >
      <Text strong style={{ fontSize: 12 }}>{t('sheet.firm_contracts.title')}</Text>
      {data && data.import_firm == null ? (
        <div style={{ marginTop: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('sheet.firm_contracts.no_buyer')}</Text>
        </div>
      ) : isLoading ? (
        <div style={{ marginTop: 6 }}><Text type="secondary" style={{ fontSize: 12 }}>…</Text></div>
      ) : !data || data.rows.length === 0 ? (
        <div style={{ marginTop: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('sheet.firm_contracts.no_firms')}</Text>
        </div>
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 6 }}>
          {data.rows.map((row) => (
            <FirmContractRow
              key={row.export_firm}
              shipmentId={shipmentId}
              row={row}
              canGenerate={canGenerate}
              canOpenContractPage={canOpenContractPage}
              templateSupported={data.contract_template_supported}
              buyerDirector={data.import_firm_director ?? ''}
              onModalOpenChange={onModalOpenChange}
            />
          ))}
        </Space>
      )}
    </div>
  );
}

interface IFirmContractRowProps {
  readonly shipmentId: number;
  readonly row: IShipmentFirmContractRow;
  readonly canGenerate: boolean;
  readonly canOpenContractPage: boolean;
  readonly templateSupported: boolean;
  readonly buyerDirector: string;
  readonly onModalOpenChange?: (open: boolean) => void;
}

function FirmContractRow({
  shipmentId,
  row,
  canGenerate,
  canOpenContractPage,
  templateSupported,
  buyerDirector,
  onModalOpenChange,
}: IFirmContractRowProps) {
  const { t } = useTranslation();
  const link = useLinkFirmContract();
  const [selected, setSelected] = useState<number | undefined>(row.framework_options[0]?.id);

  const onDone = (numberLabel: string, warning: 'bank' | 'cash' | null) => {
    toast.success(t('sheet.firm_contracts.toast_linked', { number: numberLabel }));
    if (warning) toast.warning(t(`sheet.firm_contracts.${warning}`));
  };

  const linkFramework = () => {
    if (!selected) return;
    link.mutate(
      { shipment: shipmentId, export_firm: row.export_firm, mode: 'framework', contract_id: selected },
      {
        onSuccess: (r) => onDone(r.contract_number, r.money_warning),
        onError: () => toast.error(t('sheet.firm_contracts.toast_error')),
      },
    );
  };

  const createOneTime = () => {
    link.mutate(
      { shipment: shipmentId, export_firm: row.export_firm, mode: 'one_time' },
      {
        onSuccess: (r) => onDone(r.contract_number, r.money_warning),
        onError: () => toast.error(t('sheet.firm_contracts.toast_error')),
      },
    );
  };

  return (
    <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 6 }}>
      <Space size={6} wrap>
        <Text strong style={{ fontSize: 12 }}>{row.export_firm_code}</Text>
        {row.money_warning && (
          <Tag color={row.money_warning === 'bank' ? 'blue' : 'gold'} style={{ marginInlineEnd: 0 }}>
            {t(`sheet.firm_contracts.${row.money_warning}`)}
          </Tag>
        )}
      </Space>

      {row.linked ? (
        <LinkedContract
          linked={row.linked}
          canGenerate={canGenerate}
          canOpenContractPage={canOpenContractPage}
          templateSupported={templateSupported}
          buyerDirector={buyerDirector}
          onModalOpenChange={onModalOpenChange}
        />
      ) : (
        <Space size={6} wrap style={{ marginTop: 4 }}>
          {row.framework_options.length > 0 && (
            <>
              <Select
                size="small"
                value={selected}
                onChange={setSelected}
                options={row.framework_options.map((o) => ({ value: o.id, label: o.contract_number }))}
                style={{ minWidth: 150 }}
              />
              <Button size="small" loading={link.isPending} onClick={linkFramework}>
                {t('sheet.firm_contracts.link')}
              </Button>
            </>
          )}
          <Button size="small" type="dashed" loading={link.isPending} onClick={createOneTime}>
            {t('sheet.firm_contracts.create_one_time')}
          </Button>
        </Space>
      )}
    </div>
  );
}

interface ILinkedContractProps {
  readonly linked: NonNullable<IShipmentFirmContractRow['linked']>;
  readonly canGenerate: boolean;
  readonly canOpenContractPage: boolean;
  readonly templateSupported: boolean;
  readonly buyerDirector: string;
  readonly onModalOpenChange?: (open: boolean) => void;
}

/**
 * A resolved firm split: its contract number (a link through to the contract
 * page) and the contract generator, so the operator can pull the .docx without
 * leaving the Sheet. Each is gated by whatever actually guards it — the page code
 * for the link, the `contract` resource for the generator. Without both, this
 * degrades to the plain number the panel has always shown.
 */
function LinkedContract({
  linked,
  canGenerate,
  canOpenContractPage,
  templateSupported,
  buyerDirector,
  onModalOpenChange,
}: ILinkedContractProps) {
  const { t } = useTranslation();

  return (
    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Tag color={linked.contract_type === 'ONE_TIME' ? 'orange' : 'green'} style={{ marginInlineEnd: 0 }}>
        {linked.contract_type === 'ONE_TIME'
          ? t('contracts.type.one_time')
          : t('contracts.type.framework')}
      </Tag>

      {canOpenContractPage ? (
        <Link
          to={`/contracts/${linked.contract_id}`}
          style={{ fontSize: 12 }}
          title={t('sheet.firm_contracts.open_contract')}
        >
          {linked.contract_number}
        </Link>
      ) : (
        <Text style={{ fontSize: 12 }}>{linked.contract_number}</Text>
      )}

      {canGenerate && (
        <span style={{ marginInlineStart: 'auto' }}>
          {templateSupported ? (
            <ContractAgreementButton
              size="small"
              contractId={linked.contract_id}
              defaultDirector={buyerDirector}
              onOpenChange={onModalOpenChange}
            />
          ) : (
            <Tooltip title={t('contracts.generate.country_unsupported')}>
              {/* span wrapper: a disabled button has pointer-events:none and
                  swallows hover events, so the Tooltip needs an element that does. */}
              <span style={{ display: 'inline-block', cursor: 'not-allowed' }}>
                <ContractAgreementButton size="small" contractId={linked.contract_id} disabled />
              </span>
            </Tooltip>
          )}
        </span>
      )}
    </div>
  );
}
