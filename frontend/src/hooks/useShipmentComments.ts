import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSheetStore } from '@/stores/sheetStore';
import type { IShipmentComment } from '@/types';

export interface IUseShipmentComments {
  /** true once a thread has been opened (hero or a field row); false = drawer closed. */
  isOpen: boolean;
  /** Open the whole-shipment thread (`null`) or one field's thread (its key). */
  open: (fieldKey: string | null) => void;
  close: () => void;
  /** field_key → live comment count, for the per-row 💬 badge. */
  countsByField: Record<string, number>;
}

/**
 * Drives the Detail page's two entry points into the (Sheet-authored)
 * CommentsDrawer: the hero's whole-shipment button and each row's per-field
 * icon.
 *
 * The drawer itself reads its content from `useSheetStore` (shipmentId +
 * filter), not from props — so this hook re-uses the store's own
 * `openCommentsForCell` / `openCommentsForShipment` actions (they also set
 * `activeCell`, which the composer needs to pin a new comment's field_key;
 * hand-rolled setters would miss that and silently post untagged comments).
 *
 * `isOpen` is tracked locally (NOT from the store's `commentsDrawerOpen`)
 * because that flag is a cross-page singleton: driving `open` from it here
 * would auto-open the drawer on mount if the Sheet was left open, pointed at
 * a stale shipment. The store flag is still cleared on close/unmount so a
 * trip back to the Sheet doesn't inherit a drawer left open from here.
 */
export function useShipmentComments(
  shipmentId: number,
  comments: IShipmentComment[],
): IUseShipmentComments {
  const [field, setField] = useState<string | null | undefined>(undefined);
  const openCommentsForCell = useSheetStore((s) => s.openCommentsForCell);
  const openCommentsForShipment = useSheetStore((s) => s.openCommentsForShipment);
  const setCommentsDrawerOpen = useSheetStore((s) => s.setCommentsDrawerOpen);

  const open = useCallback(
    (fieldKey: string | null) => {
      setField(fieldKey);
      if (fieldKey === null) {
        openCommentsForShipment(shipmentId);
      } else {
        openCommentsForCell(shipmentId, fieldKey);
      }
    },
    [shipmentId, openCommentsForCell, openCommentsForShipment],
  );

  const close = useCallback(() => {
    setField(undefined);
    setCommentsDrawerOpen(false);
  }, [setCommentsDrawerOpen]);

  // Leaving the page without an explicit close (nav link, browser back)
  // must not leave the Sheet inheriting a drawer pointed at this shipment.
  useEffect(() => () => setCommentsDrawerOpen(false), [setCommentsDrawerOpen]);

  // Mirrors the Sheet's own per-cell aggregation (views.py comment_counts:
  // non-deleted, grouped by field_key, replies included) so the same cell
  // shows the same count on both pages. Derived from the shipment detail
  // payload's already-loaded `comments` array — no extra per-field request.
  const countsByField = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of comments) {
      if (c.is_deleted || !c.field_key) continue;
      counts[c.field_key] = (counts[c.field_key] ?? 0) + 1;
    }
    return counts;
  }, [comments]);

  return { isOpen: field !== undefined, open, close, countsByField };
}
