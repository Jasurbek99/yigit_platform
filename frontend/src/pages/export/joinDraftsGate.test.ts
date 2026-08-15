import { describe, it, expect } from 'vitest';
import { canJoinDrafts } from './joinDraftsGate';
import type { ICurrentUser, IShipmentListItem } from '@/types';

const draft = (id: number): IShipmentListItem => ({ id, status_code: 'draft' } as unknown as IShipmentListItem);
const nonDraft = (id: number): IShipmentListItem => ({ id, status_code: 'yuklenme' } as unknown as IShipmentListItem);
// Annotate so `role` stays a UserRole literal (an unannotated const widens it to
// string, which won't assign to Pick<ICurrentUser,'role'>).
const mgr: Pick<ICurrentUser, 'role' | 'is_superuser'> = { role: 'export_manager', is_superuser: false };
const boss: Pick<ICurrentUser, 'role' | 'is_superuser'> = { role: 'boss', is_superuser: false };
const superuser: Pick<ICurrentUser, 'role' | 'is_superuser'> = { role: 'document_team', is_superuser: true };
const clerk: Pick<ICurrentUser, 'role' | 'is_superuser'> = { role: 'document_team', is_superuser: false };

describe('canJoinDrafts', () => {
  it('true for exactly two drafts + a privileged role (incl. boss) when writable', () => {
    expect(canJoinDrafts([draft(1), draft(2)], mgr, false)).toBe(true);
    expect(canJoinDrafts([draft(1), draft(2)], boss, false)).toBe(true);
    expect(canJoinDrafts([draft(1), draft(2)], superuser, false)).toBe(true);
  });
  it('false for a non-privileged role', () => {
    expect(canJoinDrafts([draft(1), draft(2)], clerk, false)).toBe(false);
  });
  it('false when the season is read-only', () => {
    expect(canJoinDrafts([draft(1), draft(2)], mgr, true)).toBe(false);
  });
  it('false when a selected row is not a draft', () => {
    expect(canJoinDrafts([draft(1), nonDraft(2)], mgr, false)).toBe(false);
  });
  it('false when the resolved-row count is not exactly two (≠2 selected or one off-page)', () => {
    expect(canJoinDrafts([draft(1)], mgr, false)).toBe(false);
    expect(canJoinDrafts([draft(1), draft(2), draft(3)], mgr, false)).toBe(false);
  });
  it('false for a null user', () => {
    expect(canJoinDrafts([draft(1), draft(2)], null, false)).toBe(false);
  });
});
