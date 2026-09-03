import { describe, it, expect } from 'vitest';
import type { ISheetRowSetting } from '@/types';
import { buildDraft, draftPatch } from './rowDraft';

function makeRow(over: Partial<ISheetRowSetting>): ISheetRowSetting {
  return {
    id: 1, field_key: 'harvest_block', row_number: 1, display_order: 1024,
    is_visible: true, is_locked: false, role_group: '', is_custom: false,
    label_tk: '', label_ru: '', label_en: '',
    who_tk: '', who_ru: '', who_en: '',
    description_tk: '', description_ru: '', description_en: '',
    style_width: null, style_align: null, style_color: null, style_font_color: null,
    style_font_weight: '', style_font_style: '', style_font_family: '', style_font_size: null,
    triggered_user: null, triggered_user_name: null, triggered_user_active: null,
    triggered_roles: [], extra_users: [],
    version: 7, updated_at: '2026-08-01T10:00:00Z', updated_by_name: 'Admin',
    deleted_at: null, default_label_key: null, default_who_key: null,
    ...over,
  };
}

describe('draftPatch', () => {
  it('never reconstructs triggered_roles or is_locked into a PATCH, even when the record changed under a stale draft (AD-17 lost-update guard)', () => {
    // The Sheet rows tab seeds a draft from the record it had open.
    const original = makeRow({ triggered_roles: ['export_manager'], is_locked: false });
    const draft = buildDraft(original);

    // The Row access tab (a second writer) changes this row's roles via a
    // dedicated bulk endpoint that never calls instance.save() — `version`
    // does not change. The shared query refetches, so `record` here is the
    // fresh row, but `SheetRowDetail` only re-seeds the draft on
    // [record.id, record.version], so the still-open draft stays stale.
    const freshRecord: ISheetRowSetting = {
      ...original,
      triggered_roles: ['transport'],
      is_locked: true,
    };

    // The admin, unaware, edits something unrelated and saves.
    const editedDraft = { ...draft, label_en: 'Edited' };

    const patch = draftPatch(freshRecord, editedDraft);

    // Only the field the admin actually touched should be in the PATCH — not
    // a stale triggered_roles/is_locked that would silently revert the Row
    // access tab's change.
    expect(patch).toEqual({ label_en: 'Edited' });
  });
});
