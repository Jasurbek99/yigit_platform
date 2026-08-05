import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canDo, canDoBackendGated, canEditField, canWriteReferenceData } from './permissions';
import { isCellEditable } from './sheetPermissions';
import { useUiStore } from '@/stores/uiStore';
import type { ICurrentUser, IRowConfig, ISheetRowSettingForUser } from '@/types';

const bossUser = {
  role: 'boss',
  is_superuser: false,
  page_permissions: {},
  resource_permissions: { shipment: { view: true, create: true, edit: true, delete: true } },
  field_permissions: { shipment: ['*'] },
} as unknown as ICurrentUser;

const bossSuperuser = { ...bossUser, is_superuser: true } as ICurrentUser;

const managerUser = {
  role: 'export_manager',
  is_superuser: false,
  page_permissions: {},
  resource_permissions: { shipment: { view: true, create: true, edit: true, delete: true } },
  field_permissions: { shipment: ['*'] },
} as unknown as ICurrentUser;

describe('boss edit mode gate', () => {
  beforeEach(() => {
    useUiStore.setState({ bossEditMode: false });
  });

  it('blocks boss edits while in view mode', () => {
    expect(canDo(bossUser, 'shipment', 'edit')).toBe(false);
    expect(canDo(bossUser, 'shipment', 'delete')).toBe(false);
    expect(canEditField(bossUser, 'shipment', 'weight_net')).toBe(false);
  });

  it('still allows boss to view in view mode', () => {
    // 'view' is exempt from the guard. Locking reads would blank the whole
    // process for him, which is the opposite of what this feature is for.
    expect(canDo(bossUser, 'shipment', 'view')).toBe(true);
  });

  it('allows boss edits once edit mode is on', () => {
    useUiStore.setState({ bossEditMode: true });
    expect(canDo(bossUser, 'shipment', 'edit')).toBe(true);
    expect(canEditField(bossUser, 'shipment', 'weight_net')).toBe(true);
  });

  it('gates a boss who is also a superuser', () => {
    // The guard must sit ABOVE the is_superuser short-circuit, or the
    // toggle silently does nothing for superuser boss accounts.
    expect(canDo(bossSuperuser, 'shipment', 'edit')).toBe(false);
    expect(canEditField(bossSuperuser, 'shipment', 'weight_net')).toBe(false);
  });

  it('never affects other roles', () => {
    expect(canDo(managerUser, 'shipment', 'edit')).toBe(true);
    expect(canEditField(managerUser, 'shipment', 'weight_net')).toBe(true);
    useUiStore.setState({ bossEditMode: true });
    expect(canDo(managerUser, 'shipment', 'edit')).toBe(true);
  });

  it('hides write controls the backend gates on a hardcoded role list', () => {
    // canDoBackendGated is for endpoints whose role allowlist the boss's matrix
    // CRUD grant cannot satisfy (shipment create, local sell plan, reference
    // data). It must stay false even in EDIT mode, or the button 403s.
    useUiStore.setState({ bossEditMode: true });
    expect(canDo(bossUser, 'shipment', 'create')).toBe(true);
    expect(canDoBackendGated(bossUser, 'shipment', 'create')).toBe(false);
    expect(canWriteReferenceData(bossUser)).toBe(false);
    // Unchanged for everyone else.
    expect(canDoBackendGated(managerUser, 'shipment', 'create')).toBe(true);
    expect(canWriteReferenceData(managerUser)).toBe(true);
  });

  it('defaults to view mode', async () => {
    // Reset the module registry and re-import the store fresh so we observe
    // the value produced by create<IUiState>(...)'s initializer itself,
    // not a value this test (or beforeEach) just wrote via setState. The
    // statically-imported `useUiStore` above is a shared singleton mutated
    // by every other test in this file, so reading it here would only prove
    // beforeEach ran, not that the initializer defaults to false.
    vi.resetModules();
    const { useUiStore: freshUiStore } = await import('@/stores/uiStore');
    expect(freshUiStore.getState().bossEditMode).toBe(false);
  });
});

// ─── Sheet grid ─────────────────────────────────────────────────────────────

const rowConfig = {
  row_number: 37,
  field_key: 'weight_net',
  default_who_key: 'sheet.who.warehouse',
  label_key: 'sheet.row.weight_net',
  input_type: 'number',
  style: {},
} as unknown as IRowConfig;

/**
 * The backend emits can_current_user_edit as a bool for EVERY row
 * (export/views.py:1418 and :1440) and knows nothing about bossEditMode, so it
 * says `true` for the boss in both modes. This is the payload the Sheet
 * actually receives.
 */
const backendSaysEditable: Record<string, ISheetRowSettingForUser> = {
  weight_net: { can_current_user_edit: true } as unknown as ISheetRowSettingForUser,
};

describe('isCellEditable — boss edit mode gate', () => {
  beforeEach(() => {
    useUiStore.setState({ bossEditMode: false });
  });

  it('locks the cell for a boss in view mode even when the backend said editable', () => {
    // Regression guard for the branch's sharpest defect: the guard must sit
    // ABOVE the `v2EditDecision ?? ...` read. Below it, the `??` fallback never
    // fires (the value is a bool, never undefined) and the whole Sheet — inline
    // edit plus Ctrl+C/X/V/Delete — stays live while the header reads Просмотр.
    expect(isCellEditable(rowConfig, backendSaysEditable, bossUser)).toBe(false);
  });

  it('unlocks the cell once the boss switches to edit mode', () => {
    useUiStore.setState({ bossEditMode: true });
    expect(isCellEditable(rowConfig, backendSaysEditable, bossUser)).toBe(true);
  });

  it('gates a boss who is also a superuser', () => {
    expect(isCellEditable(rowConfig, backendSaysEditable, bossSuperuser)).toBe(false);
  });

  it('still honours the backend decision for other roles', () => {
    expect(isCellEditable(rowConfig, backendSaysEditable, managerUser)).toBe(true);
    const backendSaysLocked: Record<string, ISheetRowSettingForUser> = {
      weight_net: { can_current_user_edit: false } as unknown as ISheetRowSettingForUser,
    };
    expect(isCellEditable(rowConfig, backendSaysLocked, managerUser)).toBe(false);
  });

  it('still refuses readonly rows regardless of role', () => {
    const readonlyRow = { ...rowConfig, input_type: 'readonly' } as unknown as IRowConfig;
    expect(isCellEditable(readonlyRow, backendSaysEditable, managerUser)).toBe(false);
  });
});
