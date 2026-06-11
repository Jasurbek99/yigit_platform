import type { ICurrentUser, IRowConfig, ISheetRowSettingForUser } from '@/types';
import { canDo, canEditField } from './permissions';

// Sheet field keys that map to junction-table resources rather than direct
// columns on Shipment. Editing these calls a dedicated action endpoint and
// permission is gated by the resource's edit flag, not field-level grants.
const JUNCTION_RESOURCE_BY_FIELD: Record<string, string> = {
  firm_splits: 'shipment_firm_split',
  block_sources: 'shipment_block_source',
};

/**
 * Legacy field-level edit check (RoleFieldPermission only). Junction fields are
 * gated by their resource's `edit` flag; everything else by the per-field grant.
 */
export function canEditCell(user: ICurrentUser | null, fieldKey: string): boolean {
  if (!user) return false;
  const junctionResource = JUNCTION_RESOURCE_BY_FIELD[fieldKey];
  if (junctionResource) {
    return canDo(user, junctionResource, 'edit');
  }
  return canEditField(user, 'shipment', fieldKey);
}

/**
 * Whether the current user may edit a given cell. Trusts the backend-computed
 * `row_settings[fk].can_current_user_edit` (which composes RoleFieldPermission
 * with the v2 row triggers: is_locked, triggered_roles/user, extra_users) when
 * present, falling back to the legacy field-level check for rows without a
 * row_settings entry. Shared by SheetGrid's renderRow and the clipboard hook so
 * cut / paste / delete obey the exact same gate as inline editing.
 */
export function isCellEditable(
  rowConfig: IRowConfig,
  rowSettings: Record<string, ISheetRowSettingForUser>,
  user: ICurrentUser | null,
): boolean {
  if (rowConfig.input_type === 'readonly') return false;
  const v2EditDecision = rowSettings[rowConfig.field_key]?.can_current_user_edit;
  return v2EditDecision ?? canEditCell(user, rowConfig.field_key);
}
