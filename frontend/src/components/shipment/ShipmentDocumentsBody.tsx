import { Checkbox } from 'antd';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { getShipmentDetailKey } from '@/hooks/useShipmentDetail';
import { InfoRow } from '@/pages/export/ShipmentDetailHelpers';
import { fmt } from '@/pages/export/ShipmentDetailHelpers.helpers';
import api from '@/services/api';
import type { IShipmentDetail, IShipmentQuality } from '@/types';

interface IShipmentDocumentsBodyProps {
  shipment: IShipmentDetail;
  missingKeys: Set<string>;
  readOnly: boolean;
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
 * "Documents & Customs" card body: the four quality certificates (each an
 * independent PATCH), the editable `status` field group, and the AD-1
 * lifecycle timestamps, which are read-only because only `transition_to()`
 * writes them.
 */
export function ShipmentDocumentsBody({
  shipment,
  missingKeys,
  readOnly,
  canEditQuality,
}: IShipmentDocumentsBodyProps) {
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

  const timestamps: [string, string | null][] = [
    ['shipment_detail.loading_started', shipment.loading_started_at],
    ['shipment_detail.customs_entry', shipment.customs_entry_at],
    ['shipment_detail.customs_exit', shipment.customs_exit_at],
    ['shipment_detail.border_crossed', shipment.border_crossed_at],
    ['shipment_detail.arrived', shipment.arrived_at],
    ['shipment_detail.sale_started', shipment.sale_started_at],
    ['shipment_detail.sale_ended', shipment.sale_ended_at],
  ];

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
          {t('shipment_detail.section_certs')}
        </div>
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
      </div>

      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="status"
        missingKeys={missingKeys}
        readOnly={readOnly}
      />

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
          {t('shipment_detail.section_timestamps')}
        </div>
        {timestamps.map(([labelKey, value]) => (
          <InfoRow key={labelKey} label={t(labelKey)} value={fmt(value)} />
        ))}
      </div>
    </>
  );
}
