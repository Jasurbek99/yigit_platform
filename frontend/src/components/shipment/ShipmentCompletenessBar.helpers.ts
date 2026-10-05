import { DETAIL_EXTRA_FIELDS, EDIT_FIELD_GROUPS } from '@/constants/shipmentEditConfig';
import type { IMissingField } from '@/types';

/**
 * Every field key that has an editable row on the Detail page — the edit
 * groups plus the Detail-only DETAIL_EXTRA_FIELDS (lifecycle timestamps are
 * operator-entered since AD-1 was retired). Anything in
 * `completeness.missing_fields` outside this set (aggregate keys like
 * `firm_splits`, `shipment_code`) has no `#detail-field-<key>` row to edit.
 */
export const EDITABLE_FIELD_KEYS: ReadonlySet<string> = new Set(
  [...EDIT_FIELD_GROUPS.flatMap((group) => group.fields), ...Object.values(DETAIL_EXTRA_FIELDS).flat()]
    .map((field) => field.key),
);

/**
 * Missing keys with no editable row that still have a place to go — their
 * chip scrolls there instead of opening an editor. The remaining
 * informational key, `shipment_code` (system-filled), has no anchor and
 * renders as a non-clickable hint.
 */
const SECTION_ANCHOR_BY_KEY: Record<string, string> = {
  firm_splits: 'section-sale',
  sales_report: 'section-sale',
  'sales_report.approved_at': 'section-sale',
  block_sources: 'section-block-sources',
  // Spec 2026-09-30-shipment-detail-full §5: no editable row, but a place to go.
  trip_id: 'detail-field-trip_id',
  packing_template: 'detail-field-packing_template',
  has_current_advance: 'detail-field-has_current_advance',
  'quality.azyk_maglumatnama': 'detail-field-quality.azyk_maglumatnama',
  'quality.suriji_gozukdiriji': 'detail-field-quality.suriji_gozukdiriji',
  'quality.hil_sertifikaty': 'detail-field-quality.hil_sertifikaty',
  'quality.kalibrowka_analiz': 'detail-field-quality.kalibrowka_analiz',
};

/**
 * Human label for a missing field key: the Edit-drawer label, else the task
 * field label, else — for a dotted key such as `quality.azyk_maglumatnama` —
 * the key itself as an i18n path. Only falls back to the raw key when all
 * three are missing.
 */
export function missingFieldLabel(fieldKey: string, t: (key: string, options?: { defaultValue: string }) => string): string {
  const candidates = [
    `shipment_edit_drawer.field.${fieldKey}`,
    `tasks.field_label.${fieldKey.replace('.', '_')}`,
    ...(fieldKey.includes('.') ? [fieldKey] : []),
  ];
  for (const key of candidates) {
    const label = t(key, { defaultValue: '' });
    if (label) return label;
  }
  return fieldKey;
}

/** Section id to scroll to for an informational key, or undefined if it's a plain system-filled field with nothing to scroll to. */
export function sectionAnchorFor(fieldKey: string): string | undefined {
  return SECTION_ANCHOR_BY_KEY[fieldKey];
}

export interface IClassifiedMissingFields {
  /** Has a `#detail-field-<key>` row — the existing amber, clickable chip. */
  actionable: IMissingField[];
  /** No editable row — muted chip, clickable only if it maps to a section. */
  informational: IMissingField[];
}

/** Split `completeness.missing_fields` into actionable vs informational per EDITABLE_FIELD_KEYS. */
export function classifyMissingFields(missingFields: IMissingField[]): IClassifiedMissingFields {
  const actionable: IMissingField[] = [];
  const informational: IMissingField[] = [];
  for (const field of missingFields) {
    if (EDITABLE_FIELD_KEYS.has(field.key)) {
      actionable.push(field);
    } else {
      informational.push(field);
    }
  }
  return { actionable, informational };
}
