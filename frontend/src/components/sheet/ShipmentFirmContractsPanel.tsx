import { useState } from 'react';
import { Button, Select, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useShipmentFirmContracts,
  useLinkFirmContract,
} from '@/hooks/useShipmentFirmContracts';
import type { IShipmentFirmContractRow } from '@/types/contract';

const { Text } = Typography;

interface IShipmentFirmContractsPanelProps {
  shipmentId: number;
}

/**
 * Per-firm contract resolution shown under the Sheet "firms" cell editor.
 * For each firm split: shows the linked contract, or the framework contracts of
 * the (firm, buyer) pair to link, plus a "create one-time" button. The shipment
 * (draft) already exists while the cell is edited, so linking works immediately.
 */
export function ShipmentFirmContractsPanel({ shipmentId }: IShipmentFirmContractsPanelProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useShipmentFirmContracts(shipmentId);

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
            <FirmContractRow key={row.export_firm} shipmentId={shipmentId} row={row} />
          ))}
        </Space>
      )}
    </div>
  );
}

function FirmContractRow({ shipmentId, row }: { shipmentId: number; row: IShipmentFirmContractRow }) {
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
        <div style={{ marginTop: 4 }}>
          <Tag color={row.linked.contract_type === 'ONE_TIME' ? 'orange' : 'green'}>
            {row.linked.contract_type === 'ONE_TIME'
              ? t('contracts.type.one_time')
              : t('contracts.type.framework')}
          </Tag>
          <Text style={{ fontSize: 12 }}>{row.linked.contract_number}</Text>
        </div>
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
