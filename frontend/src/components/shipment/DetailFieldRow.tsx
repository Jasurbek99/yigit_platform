import { useEffect, useRef, useState } from 'react';
import { Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { FieldEditor } from '@/components/FieldEditor';
import { useShipmentPatchMulti } from '@/hooks/useShipmentPatch';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';
import type { IShipmentDetail } from '@/types';

const { Text } = Typography;

// Input types where every keystroke fires onChange. We must NOT save on every
// keystroke or the user is rate-limited by the round-trip latency. Saves are
// debounced 700ms (typing ends → save fires) and also flushed on blur of the
// row's container so tabbing away commits immediately.
const DEBOUNCED_TYPES = new Set<IEditFieldConfig['inputType']>([
  'text',
  'textarea',
  'number',
]);

const SAVE_DEBOUNCE_MS = 700;

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
 * Save behaviour:
 *   - Text / textarea / number: keystrokes update local state immediately;
 *     server PATCH is debounced 700 ms (and flushed on blur of the row).
 *     The input is NEVER disabled while a save is in flight — typing keeps
 *     working and the next save supersedes the in-flight one via the
 *     useShipmentPatchMulti optimistic cache.
 *   - Select / date / boolean / option_select: discrete events, save fires
 *     immediately on each change.
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
}: IDetailFieldRowProps) {
  const { t } = useTranslation();
  const patch = useShipmentPatchMulti();
  const key = (valueKey ?? config.key) as keyof IShipmentDetail;

  // Local state mirrors the persisted value. Re-syncs when the shipment query
  // refetches (after a save lands or another tab edits the same row).
  const persisted = shipment[key];
  const [draft, setDraft] = useState<unknown>(persisted);
  useEffect(() => {
    setDraft(persisted);
  }, [persisted]);

  // Pending-debounce handle and the value queued by it. We keep both so blur
  // can flush even if React state hasn't caught up to the latest typed value
  // (rare but possible on fast keystroke trails).
  const pendingRef = useRef<{ timer: ReturnType<typeof setTimeout>; value: unknown } | null>(null);

  // Clear any pending save on unmount so we don't fire after navigation.
  useEffect(
    () => () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
    },
    [],
  );

  function commit(value: unknown) {
    if (value === persisted) return;
    patch.mutate({ id: shipment.id, fields: { [config.key]: value } });
  }

  function flushPending() {
    if (!pendingRef.current) return;
    clearTimeout(pendingRef.current.timer);
    const { value } = pendingRef.current;
    pendingRef.current = null;
    commit(value);
  }

  function scheduleDebouncedSave(next: unknown) {
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timer);
    }
    const timer = setTimeout(() => {
      pendingRef.current = null;
      commit(next);
    }, SAVE_DEBOUNCE_MS);
    pendingRef.current = { timer, value: next };
  }

  function handleChange(next: unknown) {
    setDraft(next);
    if (DEBOUNCED_TYPES.has(config.inputType)) {
      scheduleDebouncedSave(next);
    } else {
      // Discrete input — commit immediately.
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
      commit(next);
    }
  }

  // Blur handler on the wrapper. When focus leaves the row entirely (i.e.
  // the new focus target is OUTSIDE this row), flush any pending save so
  // the user's last keystroke isn't stuck in the debounce queue.
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      flushPending();
    }
  }

  const label = labelOverride ?? t(config.labelKey);
  const countryId = (shipment as unknown as Record<string, unknown>).country as number | null;

  return (
    <div
      id={`detail-field-${config.key}`}
      onBlur={handleBlur}
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
              // Deliberately NOT disabling on patch.isPending. If we did, every
              // keystroke that triggers a save would lock the input mid-word.
            />
          </div>
        )}
        {patch.isPending && <Spin size="small" />}
      </div>
    </div>
  );
}
