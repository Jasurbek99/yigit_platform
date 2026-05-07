import { useEffect, useState } from 'react';
import { Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { FieldEditor } from '@/components/FieldEditor';
import { useShipmentPatchMulti } from '@/hooks/useShipmentPatch';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';
import type { IShipmentDetail } from '@/types';

const { Text } = Typography;

interface IDetailFieldRowProps {
  shipment: IShipmentDetail;
  config: IEditFieldConfig;
  /** Pull the current value from the shipment under this key (defaults to config.key). */
  valueKey?: keyof IShipmentDetail;
  /** Override label text (otherwise uses i18n key from config). */
  labelOverride?: string;
  /** Hide the editor entirely and just show the value as text. */
  readOnly?: boolean;
  /** Optional formatter for read-only display (timestamps, currencies, etc.). */
  format?: (value: unknown) => string;
}

/**
 * One labeled, autosaving row on the Detail page sections.
 *
 * Mirrors the Sheet's edit UX but uses local controlled state + the multi-field
 * patch hook (which invalidates both `['shipments']` and `['shipment']` keys, so
 * the Sheet, lists, and this Detail page all refresh on save).
 *
 * The row carries a stable DOM id `#detail-field-<fieldKey>` so OtherTasksRow
 * can scroll to it when a task card is clicked.
 *
 * Permission: callers should pre-filter — if the current user can't edit a
 * field, set `readOnly` so the editor doesn't render. The backend also rejects
 * unauthorized PATCHes server-side, but hiding the editor avoids a UX dead
 * end.
 */
export function DetailFieldRow({
  shipment,
  config,
  valueKey,
  labelOverride,
  readOnly = false,
  format,
}: IDetailFieldRowProps) {
  const { t } = useTranslation();
  const patch = useShipmentPatchMulti();
  const key = (valueKey ?? config.key) as keyof IShipmentDetail;

  // Local state mirrors the persisted value so blur/Enter saves don't fight
  // optimistic updates from the patch hook.
  const persisted = shipment[key];
  const [draft, setDraft] = useState<unknown>(persisted);

  // Re-sync when the shipment query refetches after save.
  useEffect(() => {
    setDraft(persisted);
  }, [persisted]);

  const label = labelOverride ?? t(config.labelKey);
  const countryId = (shipment as unknown as Record<string, unknown>).country as number | null;

  function handleChange(next: unknown) {
    setDraft(next);
    // Save on every change. Most editors (Select, DatePicker, Switch) emit
    // discrete events; Inputs emit on every keystroke — for those, the
    // server PATCH is debounced naturally by the user's typing pace and
    // the optimistic cache. If we ever see save spam we can add debouncing.
    if (next !== persisted) {
      patch.mutate({ id: shipment.id, fields: { [config.key]: next } });
    }
  }

  return (
    <div
      id={`detail-field-${config.key}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 0',
        borderBottom: '1px solid #f5f5f5',
        gap: 12,
      }}
    >
      <Text style={{ flex: '0 0 180px', fontSize: 13, color: '#595959' }}>
        {label}
      </Text>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {readOnly ? (
          <Text style={{ fontSize: 13 }}>
            {format ? format(persisted) : (persisted as string | number | null) ?? '—'}
          </Text>
        ) : (
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldEditor
              config={config}
              value={draft}
              onChange={handleChange}
              countryId={countryId}
              disabled={patch.isPending}
            />
          </div>
        )}
        {patch.isPending && <Spin size="small" />}
      </div>
    </div>
  );
}
