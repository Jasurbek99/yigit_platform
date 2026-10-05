import { applyDocumentOptions, type IDocumentOptions } from '@/components/DocumentOptionsModal';
import type { IDocumentFormat } from '@/components/shipment/DocumentDownloadRow';

/** Word = the office's own form; PDF converts from it (slow, LibreOffice). */
export const WORD_PDF = ['docx', 'pdf'] as const;
/** The CMR also has the spreadsheet print-overlay. */
export const WORD_PDF_EXCEL = ['docx', 'pdf', 'xlsx'] as const;

const FMT_LABEL_KEY: Record<string, string> = { docx: 'word', pdf: 'pdf', xlsx: 'excel' };

/** The same document in RU and EN on one row: each format tagged with its language. */
export function bilingualFormats(
  langQuery: (lang: string) => Record<string, string>,
  build: (query: Record<string, string>) => IDocumentFormat[],
): IDocumentFormat[] {
  return ['ru', 'en'].flatMap((lang) =>
    build(langQuery(lang)).map((format) => ({ ...format, group: lang.toUpperCase() })),
  );
}

/**
 * One download button per format for a generated document. `query` carries
 * the document's own params (type / lang); `fmt` and the top-bar options are
 * appended, so every row builds its URL exactly as the old options modal did.
 */
export function documentFormats(
  base: string,
  query: Record<string, string>,
  formats: readonly string[],
  options: IDocumentOptions,
  t: (key: string) => string,
): IDocumentFormat[] {
  return formats.map((fmt) => {
    const params = new URLSearchParams({ ...query, fmt });
    applyDocumentOptions(params, options);
    return { label: t(`documents.${FMT_LABEL_KEY[fmt]}`), path: `${base}?${params.toString()}` };
  });
}
