import type { IShipmentListItem, ICurrentUser } from '@/types';

// Mirrors the join endpoint's gate (apps/export/views.py join action):
// apps.core.roles.PRIVILEGED_ROLES = {admin, export_manager, director}, widened
// with 'boss' at the call site (like /assign), plus a superuser bypass (like /cancel).
const JOIN_ROLES: ReadonlyArray<string> = ['admin', 'export_manager', 'director', 'boss'];

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
