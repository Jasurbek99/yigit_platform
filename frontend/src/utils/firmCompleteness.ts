import type { IExportFirm, IImportFirm } from '@/types';

/**
 * "Is this firm ready to appear on a generated document?"
 *
 * The required sets below are derived from what the document builders in
 * `backend/apps/contracts/services/document_context.py` actually read. A field
 * is required here only when leaving it blank puts a blank — or the wrong
 * language — onto a real contract, invoice, CMR or customs form.
 *
 * The signature and seal are required on BOTH firms, and the import firm's
 * director name with them, by explicit operator decision on 2026-09-10: a firm
 * with no stamp on file cannot produce a signed contract at all, so calling it
 * complete was misleading even though the plain download still renders. They
 * are the reason most firms now read amber — that is the intended answer.
 *
 * Deliberately NOT required, and why:
 *   - `*_en` (name/address/bank_details) — `_firm_attr()` falls back ru→en→tk,
 *     so an English invoice still renders; it just renders in Russian.
 *   - `director_tk` / `contact_person_tk` — the Turkmen spelling of a name that
 *     is already required in its Russian form, and both fall back to it.
 *   - `tax_code`, `swift_code`, `one_c_code`, `phone`, `city`, `code`
 *     (import), `name_short` — no document builder reads them.
 */

/** ExportFirm fields a generated document needs. Labels: `firms_admin.<key>`. */
export const REQUIRED_EXPORT_FIRM_FIELDS = [
  'code',
  'name_tk',
  'name_ru',
  'address_tk',
  'address_ru',
  'bank_details_tk',
  'bank_details_ru',
  'director',
  'director_signature',
  'director_seal',
] as const;

/** ImportFirm fields a generated document needs. Labels: `import_firms_admin.<key>`. */
export const REQUIRED_IMPORT_FIRM_FIELDS = [
  'name_company',
  'country',
  'address',
  'bank_details',
  'contact_person',
  'director_signature',
  'director_seal',
] as const;

export type ExportFirmRequiredField = (typeof REQUIRED_EXPORT_FIRM_FIELDS)[number];
export type ImportFirmRequiredField = (typeof REQUIRED_IMPORT_FIRM_FIELDS)[number];

/** Blank means null, undefined, or whitespace-only — a `country` FK is blank when null. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

/** Required ExportFirm fields that are still empty, in display order. */
export function missingExportFirmFields(firm: IExportFirm): ExportFirmRequiredField[] {
  return REQUIRED_EXPORT_FIRM_FIELDS.filter((key) => isBlank(firm[key]));
}

/** Required ImportFirm fields that are still empty, in display order. */
export function missingImportFirmFields(firm: IImportFirm): ImportFirmRequiredField[] {
  return REQUIRED_IMPORT_FIRM_FIELDS.filter((key) => isBlank(firm[key]));
}
