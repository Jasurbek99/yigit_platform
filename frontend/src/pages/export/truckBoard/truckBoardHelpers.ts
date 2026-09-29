import type { ICandidateShipment, IExternalTrip } from '@/types/externalTrip';

export const STALE_SYNC_MINUTES = 10;

export function filterTripsForShipment(
  trips: IExternalTrip[],
  shipment: ICandidateShipment | null,
): { matching: IExternalTrip[]; unknown: IExternalTrip[] } {
  if (!shipment) return { matching: trips, unknown: [] };
  return {
    matching: trips.filter((t) => t.destination_country_code === shipment.country_code),
    unknown: trips.filter((t) => t.destination_country_code === null),
  };
}

export function filterShipmentsForTrip(
  shipments: ICandidateShipment[],
  trip: IExternalTrip | null,
): ICandidateShipment[] {
  if (!trip || trip.destination_country_code === null) return shipments;
  return shipments.filter((s) => s.country_code === trip.destination_country_code);
}

export function hasVisaFor(trip: IExternalTrip, countryCode: string | null): boolean {
  if (!countryCode) return true;
  return trip.visa_country_codes.includes(countryCode);
}

export function syncAgeMinutes(lastSuccessAt: string | null, now: Date = new Date()): number | null {
  if (!lastSuccessAt) return null;
  return Math.floor((now.getTime() - new Date(lastSuccessAt).getTime()) / 60_000);
}
