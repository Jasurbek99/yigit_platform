import { useTranslation } from 'react-i18next';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { fmt, fmtDate } from '@/pages/export/ShipmentDetailHelpers.helpers';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';
import type { IShipmentDetail } from '@/types';

interface IDetailExtraFieldRowsProps {
  shipment: IShipmentDetail;
  fields: readonly IEditFieldConfig[];
  missingKeys: Set<string>;
  readOnly: boolean;
  /** Keys rendered read-only even when the card is editable. */
  lockedKeys?: ReadonlySet<string>;
  onOpenComments?: (fieldKey: string) => void;
  commentCountsByField?: Record<string, number>;
}

/**
 * Autosaving rows for DETAIL_EXTRA_FIELDS. Dates and yes/no answers get a
 * read-mode formatter — DetailFieldRow alone would print the raw ISO string
 * or boolean.
 */
export function DetailExtraFieldRows({
  shipment,
  fields,
  missingKeys,
  readOnly,
  lockedKeys,
  onOpenComments,
  commentCountsByField,
}: IDetailExtraFieldRowsProps) {
  const { t } = useTranslation();

  function formatFor(config: IEditFieldConfig): ((value: unknown) => string) | undefined {
    if (config.inputType === 'datetime') return (v) => fmt(v as string | null);
    if (config.inputType === 'date') return (v) => fmtDate(v as string | null);
    if (config.inputType === 'yes_no') {
      return (v) => (v === true ? t('common.yes') : v === false ? t('common.no') : '—');
    }
    return undefined;
  }

  return (
    <div>
      {fields.map((config) => (
        <DetailFieldRow
          key={config.key}
          shipment={shipment}
          config={config}
          readOnly={readOnly || !!lockedKeys?.has(config.key)}
          format={formatFor(config)}
          isMissing={missingKeys.has(config.key)}
          onOpenComments={onOpenComments ? () => onOpenComments(config.key) : undefined}
          commentCount={commentCountsByField?.[config.key] ?? 0}
        />
      ))}
    </div>
  );
}
