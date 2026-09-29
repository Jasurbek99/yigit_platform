import { describe, expect, it } from 'vitest';
import { filterShipmentsForTrip, filterTripsForShipment, hasVisaFor, syncAgeMinutes } from './truckBoardHelpers';
import type { ICandidateShipment, IExternalTrip } from '@/types/externalTrip';

const trip = (id: number, code: string | null, visas: string[] = []) =>
  ({ id, destination_country_code: code, visa_country_codes: visas }) as IExternalTrip;
const ship = (id: number, code: string | null) => ({ id, country_code: code }) as ICandidateShipment;

describe('truckBoardHelpers', () => {
  it('keeps same-country trips first-class and unknown-country trips separate', () => {
    const { matching, unknown } = filterTripsForShipment([trip(1, 'KZ'), trip(2, 'RU'), trip(3, null)], ship(9, 'KZ'));
    expect(matching.map((t) => t.id)).toEqual([1]);
    expect(unknown.map((t) => t.id)).toEqual([3]);
  });

  it('with no shipment selected shows every trip as matching', () => {
    const { matching, unknown } = filterTripsForShipment([trip(1, 'KZ'), trip(3, null)], null);
    expect(matching.map((t) => t.id)).toEqual([1, 3]);
    expect(unknown).toEqual([]);
  });

  it('filters shipments by the selected trip country; unknown trip country keeps all', () => {
    expect(filterShipmentsForTrip([ship(1, 'KZ'), ship(2, 'RU')], trip(5, 'RU')).map((s) => s.id)).toEqual([2]);
    expect(filterShipmentsForTrip([ship(1, 'KZ'), ship(2, 'RU')], trip(5, null)).map((s) => s.id)).toEqual([1, 2]);
  });

  it('never warns when a visa name was not recognised', () => {
    const unknown = { ...trip(1, 'KZ', []), has_unrecognised_visa: true } as IExternalTrip;
    expect(hasVisaFor(unknown, 'KZ')).toBe(true);
  });

  it('visa check is only a warning when the country code is known', () => {
    expect(hasVisaFor(trip(1, 'KZ', ['KZ']), 'KZ')).toBe(true);
    expect(hasVisaFor(trip(1, 'KZ', []), 'KZ')).toBe(false);
    expect(hasVisaFor(trip(1, 'KZ', []), null)).toBe(true);
  });

  it('computes sync age in whole minutes, null when never synced', () => {
    const now = new Date('2026-09-29T12:10:00Z');
    expect(syncAgeMinutes('2026-09-29T12:00:00Z', now)).toBe(10);
    expect(syncAgeMinutes(null, now)).toBeNull();
  });
});
