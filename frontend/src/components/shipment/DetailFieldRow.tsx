import { useState } from 'react';
import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';
import type { IShipmentDetail } from '@/types';
import { COLORS } from '@/constants/styles';
import { shouldAutoOpenEditor } from './DetailFieldRow.helpers';
import { useDetailFieldAutosave } from './useDetailFieldAutosave';
import { DetailFieldValue } from './DetailFieldValue';
import { DetailFieldRowStatus } from './DetailFieldRowStatus';

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
  /**
   * Listed in `shipment.completeness.missing_fields` (should be filled by
   * now). Merely-empty fields nothing is waiting on are NOT highlighted.
   */
  isMissing?: boolean;
  /** Opens this field's comments thread. Omit to hide the 💬 icon entirely. */
  onOpenComments?: () => void;
  /** Live comment count for this field, shown next to the 💬 icon. */
  commentCount?: number;
}

/**
 * One labeled, autosaving row on the Detail page sections. The save state
 * machine (debounce timing, discrete-vs-debounced inputs, the input is NEVER
 * disabled while a save is in flight) lives in useDetailFieldAutosave — see
 * that file for the full contract.
 *
 * Each row carries a stable DOM id `#detail-field-<fieldKey>` so OtherTasksRow
 * can scroll to it when a task card is clicked.
 *
 * Permission: callers should pre-filter — if the current user can't edit a
 * field, set `readOnly` so the editor doesn't render.
 */
export function DetailFieldRow({
  shipment,
  config,
  valueKey,
  labelOverride,
  readOnly = false,
  format,
  isMissing = false,
  onOpenComments,
  commentCount = 0,
}: IDetailFieldRowProps) {
  const { t } = useTranslation();
  const key = (valueKey ?? config.key) as keyof IShipmentDetail;
  const persisted = shipment[key];

  const { draft, saveState, handleChange, flushPending, retry } = useDetailFieldAutosave({
    shipmentId: shipment.id,
    fieldKey: config.key,
    inputType: config.inputType,
    persisted,
  });

  // Click-to-edit: the value renders as plain text until clicked, so the row
  // reads as a table cell. Booleans skip this entirely — the Switch click IS
  // the edit — and readOnly rows never enter edit mode at all.
  const [isEditing, setIsEditing] = useState(false);
  const isBoolean = config.inputType === 'boolean';
  const canEdit = !readOnly;
  const showEditor = canEdit && (isEditing || isBoolean);

  function enterEdit() {
    if (!canEdit || isBoolean) return;
    setIsEditing(true);
  }

  // Blur handler on the wrapper. When focus leaves the row entirely (the new
  // focus target is OUTSIDE this row), flush any pending save so the user's
  // last keystroke isn't stuck in the debounce queue.
  // enterEdit() unmounts the focused `Text` and mounts `FieldEditor` with
  // autoFocus in the same tick. That swap fires a blur/focusout on the
  // removed `Text` node, and `relatedTarget` on that event is unreliable
  // during a same-tick focus handoff — some browsers report `null` because
  // the new element hasn't received focus yet. `contains(null)` is false, so
  // a naive synchronous check here would see "focus left the row" and
  // immediately close the editor the same click just opened.
  // Fix: defer the decision to a microtask. By the time it runs, the
  // autoFocus on FieldEditor's input has landed and `document.activeElement`
  // reflects the real post-swap focus target — re-checked against the
  // CURRENT active element, not the stale relatedTarget, so a genuine focus
  // move out of the row is still caught and still flushes; only the in-row
  // swap is ignored.
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    const row = e.currentTarget;
    queueMicrotask(() => {
      if (!row.contains(document.activeElement)) {
        flushPending();
        setIsEditing(false);
      }
    });
  }

  const label = labelOverride ?? t(config.labelKey);
  const countryId = (shipment as unknown as Record<string, unknown>).country as number | null;

  return (
    <div
      id={`detail-field-${config.key}`}
      className="detail-row"
      onBlur={handleBlur}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 0',
        borderBottom: '1px solid #f5f5f5',
        gap: 12,
        background: isMissing ? COLORS.bgGold : undefined,
        boxShadow: isMissing ? `inset 3px 0 0 ${COLORS.warning}` : undefined,
      }}
    >
      <Text style={{ flex: '0 0 180px', fontSize: 13, color: COLORS.textTertiary }}>
        {label}
      </Text>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <DetailFieldValue
          config={config}
          showEditor={showEditor}
          canEdit={canEdit}
          isBoolean={isBoolean}
          draft={draft}
          persisted={persisted}
          format={format}
          countryId={countryId}
          defaultOpen={shouldAutoOpenEditor(config.inputType)}
          onChange={handleChange}
          onEnterEdit={enterEdit}
          statusSlot={<DetailFieldRowStatus saveState={saveState} onRetry={retry} />}
          onOpenComments={onOpenComments}
          commentCount={commentCount}
        />
      </div>
    </div>
  );
}
