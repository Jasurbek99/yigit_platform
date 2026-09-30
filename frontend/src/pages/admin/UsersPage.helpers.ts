import type { UserRole } from '@/types';

/**
 * A `loading_location` value belongs to `garawul` only. antd Form keeps an
 * unmounted field's value (`preserve: true` is the default), so a user who
 * picks `garawul` + a location, then switches to a different role before
 * submitting, would otherwise still carry that stale id in the payload. Both
 * the create and edit submit handlers route through this before sending —
 * any role other than `garawul` always sends null, regardless of what the
 * (now-hidden) location field still holds.
 */
export function resolveLoadingLocation(
  role: UserRole | null | undefined,
  loading_location: number | null | undefined,
): number | null {
  return role === 'garawul' ? (loading_location ?? null) : null;
}
