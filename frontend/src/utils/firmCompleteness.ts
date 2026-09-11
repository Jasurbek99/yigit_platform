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
 * `director_stamp` is the third variant of that pair: one photo showing seal and
 * signature together, which some firms are only able to supply that way. When it
 * is on file the separate two are neither needed nor asked for, so the pair drops
 * out of the missing list. `requiredFieldsFor` is the one place that holds this.
 *
 * `legal_type` is required on both. Leaving it blank does not blank the
 * document — it prints the WRONG legal entity, because the contract template
 * labels every seller an HJ regardless. This is how the firms whose stored
 * Turkmen and Russian names named different forms surface for staff to resolve.
 *
 * The three `patent_*` fields are required ONLY on a firm whose legal form is
 * `HT`. A sole proprietor's contract preamble cites their certificate by series,
 * number and date, so a blank one leaves a gap mid-sentence on a signed
 * contract. Every other form acts on a charter and has no certificate to give.
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
  'legal_type',
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
  'legal_type',
  'country',
  'address',
  'bank_details',
  'contact_person',
  'director_signature',
  'director_seal',
] as const;

/** Certificate fields the contract preamble cites for a sole proprietor. */
export const SOLE_PROPRIETOR_FIELDS = [
  'patent_series',
  'patent_number',
  'patent_date',
] as const;

export type ExportFirmRequiredField =
  | (typeof REQUIRED_EXPORT_FIRM_FIELDS)[number]
  | (typeof SOLE_PROPRIETOR_FIELDS)[number];
export type ImportFirmRequiredField = (typeof REQUIRED_IMPORT_FIRM_FIELDS)[number];

/** The seal/signature pair, dropped from the required set once a combined photo is on file. */
const STAMP_PAIR_FIELDS = ['director_signature', 'director_seal'] as const;

/**
 * The required fields that still apply to this firm's stamps.
 *
 * A combined `director_stamp` photo satisfies the pair on its own — see the
 * module comment — so the two separate fields stop being required.
 */
function requiredFieldsFor<T extends readonly string[]>(
  fields: T,
  firm: { director_stamp: string | null },
): T[number][] {
  if (isBlank(firm.director_stamp)) return [...fields];
  return fields.filter((key) => !STAMP_PAIR_FIELDS.includes(key as never));
}

/** Blank means null, undefined, or whitespace-only — a `country` FK is blank when null. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

/** Required ExportFirm fields that are still empty, in display order. */
export function missingExportFirmFields(firm: IExportFirm): ExportFirmRequiredField[] {
  const missing: ExportFirmRequiredField[] = requiredFieldsFor(
    REQUIRED_EXPORT_FIRM_FIELDS,
    firm,
  ).filter((key) => isBlank(firm[key]));
  // Only a sole proprietor has a certificate; see the module comment.
  if (firm.legal_type_code !== 'HT') return missing;
  return [...missing, ...SOLE_PROPRIETOR_FIELDS.filter((key) => isBlank(firm[key]))];
}

/** Required ImportFirm fields that are still empty, in display order. */
export function missingImportFirmFields(firm: IImportFirm): ImportFirmRequiredField[] {
  return requiredFieldsFor(REQUIRED_IMPORT_FIRM_FIELDS, firm).filter((key) => isBlank(firm[key]));
}
