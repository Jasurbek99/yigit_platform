import { describe, it, expect } from 'vitest';
import type { ICurrentUser, IRowConfig, ISheetRowSettingForUser, SheetInputType, UserRole } from '@/types';
import { isCellEditable } from './sheetPermissions';

function row(field_key: string, input_type: SheetInputType = 'text'): IRowConfig {
  return {
    row_number: 1,
    field_key,
    default_who_key: '',
    label_key: '',
    input_type,
    style: 'base',
  };
}

function rowSetting(can_current_user_edit: boolean): ISheetRowSettingForUser {
  return {
    id: 1,
    is_locked: false,
    labels: null,
    who: null,
    description: null,
    style: null,
    triggered_user_id: null,
    triggered_roles: [],
    extra_user_ids: [],
    can_current_user_edit,
    version: 1,
    settings_updated_at: null,
    settings_updated_by_id: null,
  };
}

function user(fieldPermissions: string[]): ICurrentUser {
  return {
    id: 1,
    username: 'soltanmyrat',
    email: '',
    first_name: '',
    last_name: '',
    role: 'loading_dept_head' as UserRole,
    is_superuser: false,
    managed_block_ids: [],
    permissions: [],
    page_permissions: {},
    resource_permissions: {},
    field_permissions: { shipment: fieldPermissions },
    active_season: { id: 1, name: '2026/2027', status: 'ACTIVE' },
    can_view_closed_seasons: false,
  };
}

describe('isCellEditable', () => {
  it('blocks every cell when the season is read-only, even a field the user could otherwise edit', () => {
    expect(
      isCellEditable(row('weight_net'), { weight_net: rowSetting(true) }, user(['*']), true),
    ).toBe(false);
  });

  it('blocks a row whose input_type is readonly, season not read-only', () => {
    expect(isCellEditable(row('shipment_code', 'readonly'), {}, user(['*']), false)).toBe(false);
  });

  it('trusts the backend v2 decision (can_current_user_edit: true) over a missing field grant', () => {
    expect(
      isCellEditable(row('weight_net'), { weight_net: rowSetting(true) }, user([]), false),
    ).toBe(true);
  });

  it('trusts the backend v2 decision (can_current_user_edit: false) even with a field grant', () => {
    expect(
      isCellEditable(row('weight_net'), { weight_net: rowSetting(false) }, user(['*']), false),
    ).toBe(false);
  });

  it('falls back to the legacy field-level grant when no row_settings entry exists', () => {
    expect(isCellEditable(row('weight_net'), {}, user(['weight_net']), false)).toBe(true);
    expect(isCellEditable(row('weight_net'), {}, user(['box_count']), false)).toBe(false);
  });

  it('denies everything for a null user regardless of season state', () => {
    expect(isCellEditable(row('weight_net'), {}, null, false)).toBe(false);
  });
});
