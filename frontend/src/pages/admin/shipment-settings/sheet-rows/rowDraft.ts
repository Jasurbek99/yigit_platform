import type { TFunction } from 'i18next';
import type { ISheetRowSetting } from '@/types';
import type { ISaveSheetRowPayload } from '@/hooks/useSheetRowSettings';

/**
 * Editable snapshot of one SheetRowSetting. The detail panel edits a draft and
 * saves it in ONE PATCH — `useSaveSheetRowSetting` invalidates the list on
 * success, so two mutations fired from a single user action would send a stale
 * `version` and 409. `extra_user_ids` is the exception: it lives in a separate
 * table behind `permissions/bulk/`, so it is sent as a second, sequential call.
 */
export interface ISheetRowDraft {
  label_tk: string;
  label_ru: string;
  label_en: string;
  who_tk: string;
  who_ru: string;
  who_en: string;
  description_tk: string;
  description_ru: string;
  description_en: string;
  is_visible: boolean;
  is_locked: boolean;
  role_group: string;
  style_color: string | null;
  style_font_color: string | null;
  style_font_weight: 'bold' | 'normal' | '';
  style_font_style: 'normal' | 'italic' | '';
  style_font_family: 'dm_sans' | 'inter' | 'mono' | 'serif' | '';
  style_font_size: number | null;
  triggered_roles: string[];
  extra_user_ids: number[];
}

/** Fields sent in the PATCH — everything in the draft except the user list. */
const PATCH_KEYS = [
  'label_tk', 'label_ru', 'label_en',
  'who_tk', 'who_ru', 'who_en',
  'description_tk', 'description_ru', 'description_en',
  'is_visible', 'is_locked', 'role_group',
  'style_color', 'style_font_color', 'style_font_weight',
  'style_font_style', 'style_font_family', 'style_font_size',
] as const;

export function activeUserIds(record: ISheetRowSetting): number[] {
  return record.extra_users.map((u) => u.id).filter((id): id is number => id !== null);
}

export function buildDraft(record: ISheetRowSetting): ISheetRowDraft {
  const draft = {} as ISheetRowDraft;
  for (const key of PATCH_KEYS) {
    // Every PATCH_KEY exists on ISheetRowSetting with the same name and type.
    (draft as unknown as Record<string, unknown>)[key] = record[key];
  }
  draft.triggered_roles = [...record.triggered_roles];
  draft.extra_user_ids = activeUserIds(record);
  return draft;
}

const sameRoles = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Only the fields the admin actually changed — keeps the PATCH minimal. */
export function draftPatch(
  record: ISheetRowSetting,
  draft: ISheetRowDraft,
): Partial<ISaveSheetRowPayload> {
  const patch: Record<string, unknown> = {};
  for (const key of PATCH_KEYS) {
    if (draft[key] !== record[key]) patch[key] = draft[key];
  }
  if (!sameRoles(draft.triggered_roles, record.triggered_roles)) {
    patch.triggered_roles = draft.triggered_roles;
  }
  return patch as Partial<ISaveSheetRowPayload>;
}

export function userDiff(record: ISheetRowSetting, draft: ISheetRowDraft) {
  const oldIds = activeUserIds(record);
  return {
    grants: draft.extra_user_ids.filter((id) => !oldIds.includes(id)),
    revokes: oldIds.filter((id) => !draft.extra_user_ids.includes(id)),
  };
}

export function isDirty(record: ISheetRowSetting, draft: ISheetRowDraft): boolean {
  const { grants, revokes } = userDiff(record, draft);
  return Object.keys(draftPatch(record, draft)).length > 0 || grants.length > 0 || revokes.length > 0;
}

/**
 * What the row is called in the admin's own language: their override first,
 * then the canonical i18n default, then the raw field_key.
 */
export function resolveRowLabel(
  record: ISheetRowSetting,
  translate: TFunction,
  lang: string,
): string {
  const code = (['tk', 'ru', 'en'] as const).find((l) => lang.startsWith(l)) ?? 'en';
  const override = record[`label_${code}`];
  if (override) return override;
  if (record.default_label_key) {
    const translated = translate(record.default_label_key, { defaultValue: '' }) as string;
    if (translated) return translated;
  }
  return record.field_key;
}
