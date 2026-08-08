/**
 * Pure selector between two pre-built values based on the `isBoss` flag.
 *
 * Extracted so the sidebar's boss/staff menu-composition choice
 * (`AppLayout.tsx`) is testable directly, rather than only observable
 * through a full component render. Generic so the test can exercise it with
 * plain dummy values instead of the real (and currently identical) menu
 * group arrays.
 */
export function pickMenuComposition<T>(isBoss: boolean, boss: T, staff: T): T {
  return isBoss ? boss : staff;
}
