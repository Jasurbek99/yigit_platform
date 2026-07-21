import { useState } from 'react';
import { Button, Flex, Modal, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { VarietySelect } from '@/components/VarietySelect';
import { useOverrideVarieties } from '@/hooks/usePallets';
import { InfoRow } from '@/pages/export/ShipmentDetailHelpers';
import { fmtDate } from '@/pages/export/ShipmentDetailHelpers.helpers';
import { COLORS } from '@/constants/styles';
import type { IShipmentDetail } from '@/types';

interface IShipmentGoodsBodyProps {
  shipment: IShipmentDetail;
  missingKeys: Set<string>;
  readOnly: boolean;
  canOverrideVariety: boolean;
  onOpenComments?: (fieldKey: string) => void;
  commentCountsByField?: Record<string, number>;
}

const CONFIDENCE_TAG: Record<string, { color: string; labelKey: string; mark: string }> = {
  high: { color: 'success', labelKey: 'pallet.confidence_high', mark: '✓ ' },
  low: { color: 'warning', labelKey: 'pallet.confidence_low', mark: '⚠ ' },
  none: { color: 'default', labelKey: 'pallet.confidence_none', mark: '' },
};

/**
 * "Goods & Loading" card body: source blocks, the pallet-derived variety
 * summary with its manual-override widget, the editable goods fields and the
 * harvest date.
 */
export function ShipmentGoodsBody({
  shipment,
  missingKeys,
  readOnly,
  canOverrideVariety,
  onOpenComments,
  commentCountsByField,
}: IShipmentGoodsBodyProps) {
  const { t } = useTranslation();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideIds, setOverrideIds] = useState<number[]>([]);
  const overrideMutation = useOverrideVarieties(shipment.id);

  const blockDisplay =
    shipment.block_sources.length === 0
      ? '—'
      : shipment.block_sources.map((b) => b.block_code).join(', ');

  const confidence = shipment.variety_confidence
    ? CONFIDENCE_TAG[shipment.variety_confidence]
    : undefined;

  return (
    <>
      <InfoRow label={t('shipment_detail.block_sources')} value={blockDisplay} />

      <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{t('variety.section_title')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {confidence && (
              <Tag color={confidence.color}>{confidence.mark}{t(confidence.labelKey)}</Tag>
            )}
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
          </div>
        </div>
        {shipment.varieties_dominant.length === 0 ? (
          <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{t('variety.empty_state')}</span>
        ) : (
          <Flex gap={4} wrap="wrap">
            {shipment.varieties_dominant.map((v) => (
              <Tag key={v.id} color={v.is_experimental ? 'orange' : undefined} style={{ margin: 0 }}>
                {v.code ? `${v.code} · ` : ''}{v.name}
                {v.is_experimental && <span style={{ marginLeft: 4, fontSize: 10 }}>(exp)</span>}
              </Tag>
            ))}
          </Flex>
        )}
      </div>

      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="goods"
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
      />
      <InfoRow label={t('shipment_detail.harvest_date')} value={fmtDate(shipment.date)} />

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
    </>
  );
}
