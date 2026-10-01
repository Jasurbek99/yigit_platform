import { canDo, canSeePage } from '@/utils/permissions';
import type { ICurrentUser } from '@/types';

/**
 * Choose / unlink a Planning trip from the Detail page. Mirrors the backend
 * gates on /transport/external-trips/: CanViewTruckBoard (the trip list is a
 * Truck Board read) AND CanAssignTrips (shipment_assign.edit).
 */
export function canManageTrips(user: ICurrentUser | null): boolean {
  return canSeePage(user, 'export.truck_board') && canDo(user, 'shipment_assign', 'edit');
}
