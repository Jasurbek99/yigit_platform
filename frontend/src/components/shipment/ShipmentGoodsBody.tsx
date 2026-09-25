import type { TFunction } from 'i18next';
import { Flex, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { ShipmentFieldGroup } from '@/components/shipment/ShipmentFieldGroup';
import { VarietyOverrideRow } from '@/components/shipment/VarietyOverrideRow';
import { groupByBlock } from '@/components/shipment/blockSourceGroups';
import { HARVEST_STATUS_FIELD } from '@/constants/shipmentEditConfig';
import { InfoRow } from '@/pages/export/ShipmentDetailHelpers';
import { fmtDate, fmtNum } from '@/pages/export/ShipmentDetailHelpers.helpers';
import { COLORS } from '@/constants/styles';
import type { IBlockSource, IShipmentDetail } from '@/types';

/** Batches within one block, oldest first. A null harvest_date sorts last. */
function sortBatchesByDate(batches: IBlockSource[]): IBlockSource[] {
  return [...batches].sort((a, b) => {
    if (a.harvest_date == null && b.harvest_date == null) return 0;
    if (a.harvest_date == null) return 1;
    if (b.harvest_date == null) return -1;
    return a.harvest_date < b.harvest_date ? -1 : a.harvest_date > b.harvest_date ? 1 : 0;
  });
}

/**
 * A block can now appear as more than one row — one per harvest batch (the
 * day that block was picked), e.g. block A picked on both the 21st and the
 * 24th. Grouped by block code so a block still reads as its bare code when
 * it has only one batch (the common case, and what every truck showed
 * before batches existed) — the date/weight breakdown only appears once a
 * block has 2+ batches to disambiguate.
 *
 * Blocks are joined with ", " UNLESS at least one block in the row has 2+
 * batches — that breakdown already uses ", " between its own batches (and
 * fmtNum's thousands separator is a comma too), so ", " between blocks
 * would be ambiguous ("A: 21.09.2026 — 3,000, 5,000, B" reads as three
 * numbers, not two batches plus a second block). "; " disambiguates once
 * any block needs the breakdown; the common all-single-batch row keeps the
 * original ", " unchanged.
 */
function formatBlockSources(blockSources: IBlockSource[], t: TFunction): string {
  if (blockSources.length === 0) return '—';

  const groups = groupByBlock(blockSources);
  const blockSeparator = groups.some((g) => g.batches.length > 1) ? '; ' : ', ';

  return groups
    .map(({ code, batches }) => {
      if (batches.length === 1) return code;

      const batchStrings = sortBatchesByDate(batches).map((b) => {
        const weight = t('shipment_detail.block_sources_weight_kg', { weight: fmtNum(b.weight_kg) });
        // A null date is dropped rather than shown as a placeholder — this
        // is operator-entered and can be genuinely unfilled; the weight
        // still needs to be visible.
        return b.harvest_date == null ? weight : `${fmtDate(b.harvest_date)} — ${weight}`;
      });
      return `${code}: ${batchStrings.join(', ')}`;
    })
    .join(blockSeparator);
}

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

  const blockDisplay = formatBlockSources(shipment.block_sources, t);

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
