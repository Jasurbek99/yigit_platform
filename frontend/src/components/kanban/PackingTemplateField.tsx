import { Select, Typography } from 'antd';
import type { AxiosError } from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { usePackingTemplates } from '@/hooks/usePackingTemplates';
import { useSetShipmentPacking, useShipmentPacking } from '@/hooks/useShipmentPacking';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IPackingTemplateFieldProps {
  shipmentId: number;
  disabled?: boolean;
}

/**
 * «Brutto/netto» (tasks.fill_gross_net) on the task card: the one field the task
 * needs — the packing template — applied the same way the Sheet's packing panel
 * applies it (POST /contracts/shipment-packing/ scope=template), which closes
 * the task server-side. Owner 2026-09-30: one field, not the whole panel.
 */
export function PackingTemplateField({ shipmentId, disabled = false }: IPackingTemplateFieldProps) {
  const { t } = useTranslation();
  const { data: templates = [], isLoading } = usePackingTemplates();
  const { data: packing } = useShipmentPacking(shipmentId);
  const apply = useSetShipmentPacking();

  function handleChange(templateId: number) {
    apply.mutate(
      { shipment: shipmentId, scope: 'template', packing_template: templateId },
      {
        onError: (err) => {
          const message = (err as AxiosError<{ error?: string }>).response?.data?.error;
          toast.error(message ?? t('common.error'));
        },
      },
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 0',
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      <Text style={{ fontSize: 12, color: COLORS.textSecondary, minWidth: 140, flexShrink: 0 }}>
        {t('tasks.field_label.packing_template')}
      </Text>
      <Select<number>
        size="small"
        style={{ flex: 1, minWidth: 0 }}
        value={packing?.whole_truck.packing_template ?? undefined}
        options={templates.map((tpl) => ({ value: tpl.id, label: tpl.name }))}
        loading={isLoading || apply.isPending}
        disabled={disabled || apply.isPending}
        onChange={handleChange}
      />
    </div>
  );
}
