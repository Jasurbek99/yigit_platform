import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { missingFieldLabel } from './ShipmentCompletenessBar.helpers';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const t = i18n.t.bind(i18n);

// Every TaskRule target field must read as words, never as a raw key
// (has_peregruz, quality.azyk_maglumatnama) on the completeness bar.
describe('missingFieldLabel', () => {
  it('uses the edit-drawer label first', () => {
    expect(missingFieldLabel('country', t)).toBe(t('shipment_edit_drawer.field.country'));
  });

  it('falls back to the task field label', () => {
    expect(missingFieldLabel('has_peregruz', t)).toBe(t('tasks.field_label.has_peregruz'));
    expect(missingFieldLabel('trip_id', t)).toBe(t('tasks.field_label.trip_id'));
  });

  it('reads a dotted certificate key as the certificate name', () => {
    expect(missingFieldLabel('quality.azyk_maglumatnama', t)).toBe(t('quality.azyk_maglumatnama'));
  });

  it('names the sales-report approval', () => {
    expect(missingFieldLabel('sales_report.approved_at', t)).not.toContain('sales_report');
  });

  it('never shows a raw key for any seeded target field', () => {
    const keys = [
      'has_current_advance', 'has_peregruz', 'loading_ended_at', 'packing_template', 'trip_id',
      'quality.azyk_maglumatnama', 'quality.hil_sertifikaty', 'quality.kalibrowka_analiz',
      'quality.suriji_gozukdiriji', 'sales_report.approved_at',
    ];
    for (const key of keys) expect(missingFieldLabel(key, t)).not.toBe(key);
  });
});
