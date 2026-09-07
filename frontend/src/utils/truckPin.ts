import L from 'leaflet';

/**
 * The truck map pin — artwork, legend and Leaflet icon geometry.
 *
 * Shared by the Fleet Map and the Sheet's truck-position modal so the same
 * truck cannot be drawn two different ways on two screens. The anchor maths
 * below is measured from the artwork; keeping one copy of it means a
 * re-export only has to be re-measured once.
 */

// Artwork geometry, measured on the SHIPPED 96px PNGs (not the 240px originals
// they were downscaled from — LANCZOS spreads the glow's alpha, so the ratios
// drift by ~0.01): the teardrop's point sits 49% across and 81.6% down the
// canvas, the rest being the soft glow beneath it. The anchor has to be derived
// from that, not centred, or every truck renders north of where it actually is.
// Re-measure if the artwork is ever re-exported.
const PIN_ASPECT = 130 / 96;
const PIN_TIP_X = 0.49;
const PIN_TIP_Y = 0.816;
const PIN_WIDTH = 34;
// The modal shows exactly one truck, so it uses this size too — there is
// nothing for it to be "selected" against.
const SELECTED_PIN_WIDTH = 48;

export type TruckState = 'moving' | 'idle' | 'stopped';

/** The three fields the legend reads. Both `ILivePosition` (Fleet Map) and
 *  `ITruckPosition` (shipment position endpoint) satisfy it. */
export interface ITruckStateFields {
  speed: number | null;
  is_online: boolean;
  is_stale: boolean;
}

/** Blue = rolling, green = parked, red = we have lost it (stale fix OR offline).
 *  A null `speed` reads as parked — the old legend showed such a device green
 *  too (online + fresh), so this is not a behaviour change, just an inherited
 *  ambiguity worth naming.
 *  Owner's call, 2026-09-03: this is the artwork's own legend, and it buys a
 *  distinction the previous three-colour dot could not draw — a truck that is
 *  stopped at the border vs one still moving. The cost is that offline and
 *  stale now share one colour; the popup still names which. */
export function truckState(p: ITruckStateFields): TruckState {
  if (p.is_stale || !p.is_online) return 'stopped';
  return (p.speed ?? 0) > 0 ? 'moving' : 'idle';
}

export const STATE_COLOR: Record<TruckState, string> = {
  moving: '#1677ff',
  idle: '#16a34a',
  stopped: '#dc2626',
};

export const PIN_URL: Record<TruckState, string> = {
  moving: '/truck-map-icons/pin-moving.png',
  idle: '/truck-map-icons/pin-idle.png',
  stopped: '/truck-map-icons/pin-stopped.png',
};

// Six possible icons (3 states x selected), built once. A fresh L.Icon per
// marker per render would make Leaflet tear down and rebuild all ~93 <img>
// nodes on every 30s refetch.
const iconCache = new Map<string, L.Icon>();

export function pinIcon(state: TruckState, isSelected: boolean): L.Icon {
  const key = `${state}:${isSelected}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const width = isSelected ? SELECTED_PIN_WIDTH : PIN_WIDTH;
  const height = Math.round(width * PIN_ASPECT);
  const tipY = Math.round(height * PIN_TIP_Y);
  const icon = L.icon({
    iconUrl: PIN_URL[state],
    iconSize: [width, height],
    iconAnchor: [Math.round(width * PIN_TIP_X), tipY],
    popupAnchor: [0, -tipY],
  });
  iconCache.set(key, icon);
  return icon;
}
