import type { IShipmentListItem, ICurrentUser } from '@/types';
import { canUserJoin } from '@/components/sheet/joinHelpers';

/**
 * Whether the "Join drafts" bulk-bar button should show. True only when a
 * privileged user has resolved exactly two selected rows, both drafts, in a
 * writable season. `selectedRows` are the rows RESOLVED from the current page's
 * data — a selection whose row isn't on the current page resolves to <2 and
 * correctly hides the button (cross-page selection is out of scope).
 */
export function canJoinDrafts(
  selectedRows: IShipmentListItem[],
  user: Pick<ICurrentUser, 'role' | 'is_superuser'> | null,
  isReadOnly: boolean,
): boolean {
  if (isReadOnly || !user) return false;
  if (!canUserJoin(user)) return false;
  if (selectedRows.length !== 2) return false;
  return selectedRows.every((r) => r.status_code === 'draft');
}
