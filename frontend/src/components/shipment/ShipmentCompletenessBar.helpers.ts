import { EDIT_FIELD_GROUPS } from '@/constants/shipmentEditConfig';
import type { IMissingField } from '@/types';

/**
 * Every field key that has an editable row on the Detail page. Anything in
 * `completeness.missing_fields` outside this set (AD-1 timestamps written
 * only by `transition_to()`, aggregate keys like `firm_splits`) has no
 * `#detail-field-<key>` row to jump to.
 */
export const EDITABLE_FIELD_KEYS: ReadonlySet<string> = new Set(
  EDIT_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.key)),
);

/**
 * Missing keys that describe a page *section* rather than a single field —
 * their chip scrolls to that section instead of opening an editor. Every
 * other informational key (AD-1 timestamps, `shipment_code`) has no anchor
 * and renders as a non-clickable hint.
 */
const SECTION_ANCHOR_BY_KEY: Record<string, string> = {
  firm_splits: 'section-sale',
  sales_report: 'section-sale',
  block_sources: 'section-block-sources',
};

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
