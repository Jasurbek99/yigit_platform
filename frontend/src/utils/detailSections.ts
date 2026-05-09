/**
 * Helpers for the Shipment Detail page's section grid.
 *
 * The Detail page renders all fields in a flat 2-column grid (no accordion).
 * `sectionForFieldKey` is still used by OtherTasksRow's click handler so
 * scrolling lands the user on the right field.
 */

import { EDIT_FIELD_GROUPS } from '@/constants/shipmentEditConfig';
import type { ICurrentUser } from '@/types';

export type SectionKey = 'logistics' | 'transport' | 'goods' | 'documents' | 'finance';

export const SUPERVISOR_ROLES = new Set(['export_manager', 'boss', 'admin', 'director']);

// EDIT_FIELD_GROUPS uses 6 logical groups; the Detail page renders 5 panels
// (status → documents, notes → finance).
const GROUP_TO_SECTION: Record<string, SectionKey> = {
  logistics: 'logistics',
  transport: 'transport',
  goods: 'goods',
  status: 'documents',
  finance: 'finance',
  notes: 'finance',
};

/**
 * Resolve a field key (e.g. 'weight_net' or 'quality.azyk_maglumatnama')
 * back to its rendered section. Used by OtherTasksRow's click handler to
 * scroll to a task's first target field.
 */
export function sectionForFieldKey(fieldKey: string): SectionKey | null {
  const top = fieldKey.split('.', 1)[0];
  if (top === 'firm_splits') return 'logistics';
  if (top === 'block_sources') return 'goods';
  if (top === 'quality') return 'documents';
  for (const group of EDIT_FIELD_GROUPS) {
    if (group.fields.some((f) => f.key === top)) {
      return GROUP_TO_SECTION[group.key] ?? null;
    }
  }
  return null;
}

/** True when the current user is a supervisor role (or superuser). */
export function isSupervisor(user: ICurrentUser | null): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  return SUPERVISOR_ROLES.has(user.role);
}
