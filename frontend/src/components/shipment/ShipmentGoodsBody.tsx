import { Flex, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { VarietyOverrideRow } from '@/components/shipment/VarietyOverrideRow';
import { HARVEST_STATUS_FIELD } from '@/constants/shipmentEditConfig';
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

/**
 * "Goods & Loading" card body, top to bottom: export code, source blocks,
 * harvest status (moved here from Documents & Customs — see
 * `HARVEST_STATUS_FIELD` in shipmentEditConfig.ts), the pallet-derived
 * variety value, its confidence/manual-override row, the editable goods
 * fields and the harvest date.
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

  const blockDisplay =
    shipment.block_sources.length === 0
      ? '—'
      : shipment.block_sources.map((b) => b.block_code).join(', ');

  return (
    <>
      <InfoRow label={t('shipment_detail.export_code')} value={shipment.export_code ?? '—'} />

      {/* These are currently the PLANNED greenhouse blocks (the draft's
          split), not what was actually loaded. Product owner: a real
          loaded block-source row is to be added here later — not
          implemented yet, this comment is just to keep the intent from
          getting lost. */}
      <div id="section-block-sources">
        <InfoRow label={t('shipment_detail.block_sources')} value={blockDisplay} />
      </div>

      <DetailFieldRow
        shipment={shipment}
        config={HARVEST_STATUS_FIELD}
        readOnly={readOnly}
        isMissing={missingKeys.has(HARVEST_STATUS_FIELD.key)}
        onOpenComments={onOpenComments ? () => onOpenComments(HARVEST_STATUS_FIELD.key) : undefined}
        commentCount={commentCountsByField?.[HARVEST_STATUS_FIELD.key] ?? 0}
      />

      <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
          {t('variety.section_title')}
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

      <VarietyOverrideRow shipment={shipment} canOverrideVariety={canOverrideVariety} />

      <ShipmentFieldGroup
        shipment={shipment}
        groupKey="goods"
        missingKeys={missingKeys}
        readOnly={readOnly}
        onOpenComments={onOpenComments}
        commentCountsByField={commentCountsByField}
        excludeKeys={[HARVEST_STATUS_FIELD.key]}
      />
      <InfoRow label={t('shipment_detail.harvest_date')} value={fmtDate(shipment.date)} />
    </>
  );
}
