import { useMemo } from 'react';
import { useLivePositions } from '@/hooks/useLivePositions';

const NON_ALNUM = /[^A-Z0-9]/g;
const FIRST_TOKEN = /[/\s]/;

function normalizePlate(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(NON_ALNUM, '');
}

interface IProps {
  truckPlate: string | null | undefined;
  /** Whether the cell's own (operator-typed) text is non-empty — controls the
   *  leading separator so an empty R15 cell doesn't render " · Address". */
  hasValue: boolean;
}

/**
 * Inline GPS location suffix for the R15 (vehicle_live_status) cell — renders
 * "Location" or " · Location" right after the cell's own text, truncated
 * together by the cell's existing ellipsis. Prefers the reverse-geocoded
 * `address`; when Traccar has none for the fix (common — geocoding can fail
 * or be unavailable) but the position still resolved to a `geofence_name`,
 * that name is shown instead of leaving the cell blank. Both blank (or no
 * matching position at all) → renders nothing.
 *
 * Matched client-side against the already-fetched live-positions list (the
 * same shared TanStack Query cache and 30s poll the Fleet Map uses) — NOT a
 * per-shipment query, so mounting this on every R15 row does not multiply
 * network requests. `SheetCell.truckMap.test.tsx` pins that a per-shipment
 * poll (`useShipmentTruckPosition`) must never mount here; this hook is the
 * one exception, because its queryKey is shared across every consumer.
 *
 * Best-effort only: matches by `truck_plate`, so a shipment resolved via a
 * manual device link or `truck_head_id` whose plate text differs shows
 * nothing here — the pin/modal still resolves those correctly. Likewise, a
 * device with no stored position at all, or whose last fix was invalid
 * (`valid=False`, excluded from `live-positions/`), has neither an address
 * nor a geofence to fall back to.
 */
export function SheetCellTruckAddress({ truckPlate, hasValue }: IProps) {
  const { data } = useLivePositions();
  const text = useMemo(() => {
    const token = (truckPlate ?? '').trim().split(FIRST_TOKEN)[0];
    const target = normalizePlate(token);
    if (!target) return null;
    const match = data?.find((p) => normalizePlate(p.plate) === target);
    return match?.address || match?.geofence_name || null;
  }, [data, truckPlate]);

  if (!text) return null;
  return <span title={text}>{hasValue ? ' · ' : ''}{text}</span>;
}
