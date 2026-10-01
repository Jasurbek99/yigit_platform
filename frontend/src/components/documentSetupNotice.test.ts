import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { setupItems, setupNoticeText } from './documentSetupNotice';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('setupItems', () => {
  it('a regular truck: driver + plate become one «choose a Planning trip» item at the trip block', () => {
    expect(setupItems(['import_firm', 'driver_name', 'truck_plate'], false)).toEqual([
      { key: 'import_firm', anchor: 'detail-field-import_firm' },
      { key: 'truck', anchor: 'detail-field-trip_id' },
    ]);
  });

  it('a gapy truck keeps driver and plate as typed fields', () => {
    expect(setupItems(['driver_name', 'truck_plate'], true)).toEqual([
      { key: 'driver_name', anchor: 'detail-field-driver_name' },
      { key: 'truck_plate', anchor: 'detail-field-truck_plate' },
    ]);
  });
});

describe('setupNoticeText (off the shipment page)', () => {
  it('a regular truck is sent to a Planning trip, not to the Sheet, for its driver and plate', () => {
    const text = setupNoticeText(setupItems(['country', 'driver_name', 'truck_plate'], false), [], i18n.t);
    expect(text).toContain(i18n.t('documents_page.complete_on_sheet', { fields: i18n.t('documents_page.field.country') }));
    expect(text).toContain(i18n.t('documents_page.choose_trip'));
    expect(text).not.toContain(i18n.t('documents_page.field.driver_name'));
  });

  it('a gapy truck still fills driver and plate on the Sheet', () => {
    const text = setupNoticeText(setupItems(['driver_name'], true), [], i18n.t);
    expect(text).toBe(i18n.t('documents_page.complete_on_sheet', { fields: i18n.t('documents_page.field.driver_name') }));
  });
});
