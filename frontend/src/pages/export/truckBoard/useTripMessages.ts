import { useTranslation } from 'react-i18next';
import type { IExternalTrip } from '@/types/externalTrip';
import { pushErrorParts } from './truckBoardHelpers';

/** Conflict / refused-push sentences, worded in the viewer's language. */
export function useTripMessages() {
  const { t } = useTranslation();
  return {
    conflict: (trip: IExternalTrip) =>
      trip.conflict_kind
        ? t(`truck_board.conflict.${trip.conflict_kind}`, { from: trip.conflict_from, to: trip.conflict_to })
        : null,
    pushError: (stored: string) => {
      const { op, code } = pushErrorParts(stored);
      // Nothing re-sends a rejection by itself: the user has to reject again.
      if (op === 'rejection' && code === 'PLANNING_UNAVAILABLE') {
        return t('truck_board.push_error.rejection_unavailable');
      }
      return t(`truck_board.push_error.${code}`, {
        defaultValue: t('truck_board.push_error.generic', { op: t(`truck_board.push_op.${op}`, op), code }),
      });
    },
    status: (status: string) => t(`truck_board.status.${status}`, status),
  };
}
