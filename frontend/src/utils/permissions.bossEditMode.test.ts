import { beforeEach, describe, expect, it } from 'vitest';
import { canDo, canEditField } from './permissions';
import { useUiStore } from '@/stores/uiStore';
import type { ICurrentUser } from '@/types';

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

  it('defaults to view mode', () => {
    useUiStore.setState({ bossEditMode: undefined as unknown as boolean });
    expect(useUiStore.getState().bossEditMode).toBeFalsy();
  });
});
