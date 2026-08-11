/** One source of truth for the denormalized `truck_plate` string ("{head}/{trailer}"). */
export function composeTruckPlate(headPlate?: string | null, trailerPlate?: string | null): string {
  return [headPlate ?? '', trailerPlate ?? ''].filter(Boolean).join('/');
}
