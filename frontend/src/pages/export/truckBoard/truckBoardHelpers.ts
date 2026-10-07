import type { CSSProperties } from 'react';
import { isAxiosError } from 'axios';
import { Modal } from 'antd';
import type { TFunction } from 'i18next';
import { COLORS } from '@/constants/styles';
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
  if (!countryCode || trip.has_unrecognised_visa) return true;
  return trip.visa_country_codes.includes(countryCode);
}

export function syncAgeMinutes(lastSuccessAt: string | null, now: Date = new Date()): number | null {
  if (!lastSuccessAt) return null;
  return Math.floor((now.getTime() - new Date(lastSuccessAt).getTime()) / 60_000);
}

/** Stored push error "op: CODE" → its parts, so the UI can word it per language. */
export function pushErrorParts(stored: string): { op: string; code: string } {
  const [op, code] = stored.includes(': ') ? stored.split(': ', 2) : ['', stored];
  return { op, code };
}

/** Planning never got our rejection (it is not re-sent by itself): show it and allow rejecting again. */
export function rejectionFailed(trip: Pick<IExternalTrip, 'last_push_error'>): boolean {
  return !!trip.last_push_error?.startsWith('rejection:');
}

/** The contract error key (`{"error": "<code>"}`) of a failed request; 'generic' otherwise. */
export function apiErrorKey(err: unknown): string {
  const data = isAxiosError(err) ? (err.response?.data as { error?: unknown } | undefined) : undefined;
  return typeof data?.error === 'string' ? data.error : 'generic';
}

/** Card frame shared by the shipment and trip cards on the board. */
export function boardCardStyle(selected: boolean, dimmed = false): CSSProperties {
  return {
    background: selected ? COLORS.bgBlue : COLORS.white,
    border: selected ? `2px solid ${COLORS.primary}` : `1px solid ${COLORS.border}`,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
    cursor: 'pointer',
    opacity: dimmed ? 0.55 : 1,
  };
}

/** Ask before joining a trip whose destination country Planning has not set. */
export function confirmUnknownCountry(t: TFunction, onOk: () => void): void {
  Modal.confirm({ title: t('truck_board.unknown_country_confirm'), onOk });
}
