import { useEffect, useRef, useState } from 'react';
import { useShipmentPatchMulti } from '@/hooks/useShipmentPatch';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';
import { deriveSaveState, type SaveState } from './DetailFieldRow.helpers';

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

interface IUseDetailFieldAutosaveArgs {
  shipmentId: number;
  /** The API field name to PATCH — always config.key, even when the row reads
   * its display value from a different key via DetailFieldRow's valueKey. */
  fieldKey: string;
  inputType: IEditFieldConfig['inputType'];
  persisted: unknown;
}

interface IUseDetailFieldAutosaveResult {
  draft: unknown;
  saveState: SaveState;
  /** Wire this to the editor's onChange. */
  handleChange: (next: unknown) => void;
  /** Flush any pending debounced save immediately (call on row blur). */
  flushPending: () => void;
  /** Re-commit the current draft (call from the error state's retry link). */
  retry: () => void;
}

/**
 * Owns one DetailFieldRow's save state machine: the local draft mirror, the
 * "has this row's own save ever succeeded" flag, and the debounce/flush
 * plumbing. Extracted out of DetailFieldRow so the component itself stays a
 * thin composition point — see DetailFieldRow.tsx for the save-behaviour
 * contract (debounce timing, never-disable-while-pending, etc).
 */
export function useDetailFieldAutosave({
  shipmentId,
  fieldKey,
  inputType,
  persisted,
}: IUseDetailFieldAutosaveArgs): IUseDetailFieldAutosaveResult {
  const patch = useShipmentPatchMulti();

  // Local state mirrors the persisted value. Re-syncs when the shipment query
  // refetches (after a save lands or another tab edits the same row).
  const [draft, setDraft] = useState<unknown>(persisted);
  useEffect(() => {
    setDraft(persisted);
  }, [persisted]);

  // Tracks whether this row's own save has ever succeeded. Reset to false the
  // moment the user edits again (see handleChange) so a stale "Saved" never
  // sits next to a value the user has since changed.
  const [hasSavedOnce, setHasSavedOnce] = useState(false);
  const saveState = deriveSaveState({
    isPending: patch.isPending,
    isError: patch.isError,
    hasSavedOnce,
  });

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
    patch.mutate(
      { id: shipmentId, fields: { [fieldKey]: value } },
      { onSuccess: () => setHasSavedOnce(true) },
    );
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
    setHasSavedOnce(false);
    setDraft(next);
    if (DEBOUNCED_TYPES.has(inputType)) {
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

  function retry() {
    commit(draft);
  }

  return { draft, saveState, handleChange, flushPending, retry };
}
