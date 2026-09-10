import { describe, it, expect } from 'vitest';
import {
  REQUIRED_EXPORT_FIRM_FIELDS,
  REQUIRED_IMPORT_FIRM_FIELDS,
  missingExportFirmFields,
  missingImportFirmFields,
} from './firmCompleteness';
import type { IExportFirm, IImportFirm } from '@/types';

function exportFirm(overrides: Partial<IExportFirm> = {}): IExportFirm {
  return {
    id: 1,
    code: 'YGT',
    name_short: null,
    name_tk: 'Ýigit HJ',
    name_ru: 'Йигит',
    name_en: null,
    address_tk: 'Aşgabat',
    address_ru: 'Ашхабад',
    address_en: null,
    bank_details_tk: 'Bank TK',
    bank_details_ru: 'Банк RU',
    bank_details_en: null,
    director: 'Чарыев А.',
    director_tk: null,
    tax_code: null,
    swift_code: null,
    one_c_code: null,
    is_active: true,
    is_gapy_satys: false,
    director_signature: '/media/export_firms/signatures/ygt.png',
    director_seal: '/media/export_firms/seals/ygt.png',
    ...overrides,
  };
}

function importFirm(overrides: Partial<IImportFirm> = {}): IImportFirm {
  return {
    id: 1,
    code: null,
    name_company: 'ТОО Альфа',
    name_short: null,
    country: 3,
    country_name: 'Kazakhstan',
    city: null,
    city_name: null,
    address: 'Алматы, ул. 1',
    bank_details: 'IBAN KZ...',
    contact_person: 'Иванов И.',
    contact_person_tk: null,
    phone: null,
    is_active: true,
    is_gapy_satys: false,
    director_signature: '/media/import_firms/signatures/alfa.png',
    director_seal: '/media/import_firms/seals/alfa.png',
    ...overrides,
  };
}

describe('missingExportFirmFields', () => {
  it('returns nothing when every document field is filled', () => {
    expect(missingExportFirmFields(exportFirm())).toEqual([]);
  });

  it('reports null, empty and whitespace-only values as missing', () => {
    const firm = exportFirm({ address_tk: null, bank_details_ru: '', director: '   ' });
    expect(missingExportFirmFields(firm)).toEqual(['address_tk', 'bank_details_ru', 'director']);
  });

  it('ignores fields the document builders fall back on or never read', () => {
    // EN columns fall back ru→tk; director_tk falls back to director;
    // tax/swift/1C codes and name_short are read by no document builder.
    const firm = exportFirm({
      name_en: null,
      address_en: null,
      bank_details_en: null,
      director_tk: null,
      name_short: null,
      tax_code: null,
      swift_code: null,
      one_c_code: null,
    });
    expect(missingExportFirmFields(firm)).toEqual([]);
  });

  it('flags a missing signature and seal — a firm with no stamp cannot sign', () => {
    const firm = exportFirm({ director_signature: null, director_seal: null });
    expect(missingExportFirmFields(firm)).toEqual(['director_signature', 'director_seal']);
  });

  it('keeps the declared field order', () => {
    const blank = exportFirm({
      code: '',
      name_tk: '',
      name_ru: '',
      address_tk: '',
      address_ru: '',
      bank_details_tk: '',
      bank_details_ru: '',
      director: '',
      director_signature: null,
      director_seal: null,
    });
    expect(missingExportFirmFields(blank)).toEqual([...REQUIRED_EXPORT_FIRM_FIELDS]);
  });
});

describe('missingImportFirmFields', () => {
  it('returns nothing when every document field is filled', () => {
    expect(missingImportFirmFields(importFirm())).toEqual([]);
  });

  it('treats a null country FK as missing', () => {
    expect(missingImportFirmFields(importFirm({ country: null }))).toEqual(['country']);
  });

  it('ignores the Turkmen director spelling and the fields no document reads', () => {
    // contact_person_tk falls back to contact_person, which IS required;
    // phone, city, code and name_short are read by no document builder.
    const firm = importFirm({
      contact_person_tk: null,
      phone: null,
      city: null,
      code: null,
      name_short: null,
    });
    expect(missingImportFirmFields(firm)).toEqual([]);
  });

  it('flags the director name, signature and seal', () => {
    const firm = importFirm({
      contact_person: null,
      director_signature: null,
      director_seal: null,
    });
    expect(missingImportFirmFields(firm)).toEqual([
      'contact_person',
      'director_signature',
      'director_seal',
    ]);
  });

  it('keeps the declared field order', () => {
    const blank = importFirm({
      name_company: '',
      country: null,
      address: '',
      bank_details: '',
      contact_person: '',
      director_signature: null,
      director_seal: null,
    });
    expect(missingImportFirmFields(blank)).toEqual([...REQUIRED_IMPORT_FIRM_FIELDS]);
  });
});
