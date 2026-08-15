import type { IShipmentListItem, ICurrentUser } from '@/types';

// Mirrors backend PRIVILEGED_ROLES (apps/export/services/shipment.py:44) — the
// only roles the /join/ endpoint accepts. INCLUDES boss.
const JOIN_ROLES: ReadonlyArray<string> = ['export_manager', 'director', 'boss'];

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
  if (!(JOIN_ROLES.includes(user.role) || user.is_superuser === true)) return false;
  if (selectedRows.length !== 2) return false;
  return selectedRows.every((r) => r.status_code === 'draft');
}
