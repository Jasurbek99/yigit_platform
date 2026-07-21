import { Checkbox } from 'antd';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getShipmentDetailKey } from '@/hooks/useShipmentDetail';
import api from '@/services/api';
import type { IShipmentDetail, IShipmentQuality } from '@/types';

interface IShipmentQualityBodyProps {
  shipment: IShipmentDetail;
  canEditQuality: boolean;
}

const QUALITY_FIELDS: (keyof IShipmentQuality)[] = [
  'azyk_maglumatnama',
  'suriji_gozukdiriji',
  'hil_sertifikaty',
  'kalibrowka_analiz',
];

const EMPTY_QUALITY: IShipmentQuality = {
  azyk_maglumatnama: false,
  suriji_gozukdiriji: false,
  hil_sertifikaty: false,
  kalibrowka_analiz: false,
};

/**
 * "Quality Certificates" card body: the four quality-certificate checkboxes,
 * each an independent PATCH to `/quality/`. Split out of ShipmentDocumentsBody
 * into its own stage card. These fields aren't part of the completeness
 * contract, so the caller passes a constant `missingCount={0}` — the card
 * always shows the "complete" badge.
 */
export function ShipmentQualityBody({ shipment, canEditQuality }: IShipmentQualityBodyProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const id = String(shipment.id);

  const qualityMutation = useMutation({
    mutationFn: async ({ field, checked }: { field: keyof IShipmentQuality; checked: boolean }) => {
      await api.patch(`/export/shipments/${id}/quality/`, { [field]: checked });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(id) });
    },
  });

  const q: IShipmentQuality = shipment.quality ?? EMPTY_QUALITY;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {QUALITY_FIELDS.map((field) => (
        <Checkbox
          key={field}
          id={`detail-field-quality.${field}`}
          checked={q[field]}
          disabled={!canEditQuality || qualityMutation.isPending}
          onChange={(e) => qualityMutation.mutate({ field, checked: e.target.checked })}
        >
          {t(`quality.${field}`)}
        </Checkbox>
      ))}
    </div>
  );
}
