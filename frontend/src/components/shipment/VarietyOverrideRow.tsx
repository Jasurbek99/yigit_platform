import { useState } from 'react';
import { Button, Modal, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { VarietySelect } from '@/components/VarietySelect';
import { useOverrideVarieties } from '@/hooks/usePallets';
import type { IShipmentDetail } from '@/types';

interface IVarietyOverrideRowProps {
  shipment: IShipmentDetail;
  canOverrideVariety: boolean;
}

const CONFIDENCE_TAG: Record<string, { color: string; labelKey: string; mark: string }> = {
  high: { color: 'success', labelKey: 'pallet.confidence_high', mark: '✓ ' },
  low: { color: 'warning', labelKey: 'pallet.confidence_low', mark: '⚠ ' },
  none: { color: 'default', labelKey: 'pallet.confidence_none', mark: '' },
};

/**
 * "From pallet data" confidence tag plus the "Manual override" button and
 * modal for `varieties_dominant`. Split out from the variety value row per
 * product owner: confidence/override is a separate concern from the variety
 * value itself, so it gets its own row below it.
 */
export function VarietyOverrideRow({ shipment, canOverrideVariety }: IVarietyOverrideRowProps) {
  const { t } = useTranslation();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideIds, setOverrideIds] = useState<number[]>([]);
  const overrideMutation = useOverrideVarieties(shipment.id);

  const confidence = shipment.variety_confidence
    ? CONFIDENCE_TAG[shipment.variety_confidence]
    : undefined;

  if (!confidence && !canOverrideVariety) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 0',
        borderBottom: '1px solid #f5f5f5',
      }}
    >
      {confidence && <Tag color={confidence.color}>{confidence.mark}{t(confidence.labelKey)}</Tag>}
      {canOverrideVariety && (
        <Button
          size="small"
          onClick={() => {
            setOverrideIds(shipment.varieties_dominant.map((v) => v.id));
            setOverrideOpen(true);
          }}
        >
          {t('variety.override_btn')}
        </Button>
      )}

      <Modal
        open={overrideOpen}
        title={t('variety.override_modal_title')}
        okText={t('variety.override_apply')}
        cancelText={t('variety.override_cancel')}
        confirmLoading={overrideMutation.isPending}
        onCancel={() => setOverrideOpen(false)}
        onOk={() => {
          overrideMutation.mutate(overrideIds, { onSuccess: () => setOverrideOpen(false) });
        }}
      >
        <VarietySelect
          mode="multiple"
          value={overrideIds}
          onChange={(ids) => setOverrideIds(ids)}
          style={{ width: '100%' }}
        />
      </Modal>
    </div>
  );
}
