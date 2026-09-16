/**
 * The Weekly Plan grid's role rules, as a table.
 *
 * These five predicates were inline in a 913-line component with ~10 hooks, so
 * nothing asserted them: the boss widening (Aug 2026) changed four of them and
 * the only safety net was clicking the page. This file is that net.
 *
 * Two rows are the point of the whole suite:
 *   - `director` edits the harvest grid but NOT an actual value.
 *   - a closed season beats every role, admin included.
 */
import { describe, it, expect } from 'vitest';

import { planGridCapabilities } from './WeeklyPlanGrid.roles';

// The roles that actually reach this page. Not the full role set — the two
// predicates behind `canEditActual` are literal `===` comparisons, so a role
// outside this list can only be false; the list is the page's audience, not a
// claim about every role in the system.
const ROLES = ['admin', 'boss', 'director', 'export_manager', 'greenhouse_manager'] as const;

function caps(role: string | null | undefined, isReadOnly = false) {
  return planGridCapabilities({ role, isReadOnly });
}

describe('planGridCapabilities — open season', () => {
  it('admin holds every capability except the actual override', () => {
    // 2026-09-16: the grid went plan-only for every role, so `planOnlyCells` is
    // true here and `canEditActual` — defined as `isAdminLike && !planOnlyCells`
    // — is dead even for admin. Restoring the commented-out `role === 'boss'`
    // line in WeeklyPlanGrid.roles.ts flips both back.
    const c = caps('admin');
    expect(c).toEqual({
      isAdmin: true,
      isAdminLike: true,
      canEditHarvest: true,
      planOnlyCells: true,
      canEditTrucks: true,
      canGenerateTasks: true,
      canEditActual: false,
    });
  });

  it('every role that reaches this page sees a plan-only cell', () => {
    for (const role of ROLES) {
      expect(caps(role).planOnlyCells).toBe(true);
    }
  });

  it('boss edits the harvest grid but sees a plan-only cell', () => {
    const c = caps('boss');
    expect(c.canEditHarvest).toBe(true);
    expect(c.isAdminLike).toBe(true);
    expect(c.planOnlyCells).toBe(true);
    expect(c.canGenerateTasks).toBe(true);
  });

  it('boss cannot edit trucks — the backend TRUCK_WRITE gate has no boss', () => {
    expect(caps('boss').isAdmin).toBe(false);
    expect(caps('boss').canEditTrucks).toBe(false);
  });

  it('boss cannot edit an actual — his cell is plan-only, so the capability is dead', () => {
    expect(caps('boss').canEditActual).toBe(false);
  });

  it('director edits the harvest grid but NOT an actual value', () => {
    const c = caps('director');
    expect(c.canEditHarvest).toBe(true);
    expect(c.canEditTrucks).toBe(true);
    expect(c.canEditActual).toBe(false);
  });

  it('export_manager edits trucks and generates tasks, nothing on the harvest grid', () => {
    const c = caps('export_manager');
    expect(c.canEditTrucks).toBe(true);
    expect(c.canGenerateTasks).toBe(true);
    expect(c.canEditHarvest).toBe(false);
    expect(c.canEditActual).toBe(false);
  });

  it('greenhouse_manager holds no page-level capability (his access is per-block)', () => {
    const c = caps('greenhouse_manager');
    expect(c.canEditHarvest).toBe(false);
    expect(c.canEditTrucks).toBe(false);
    expect(c.canGenerateTasks).toBe(false);
    expect(c.canEditActual).toBe(false);
  });

  it('an unauthenticated visitor holds no capability', () => {
    for (const role of [null, undefined]) {
      // `planOnlyCells` is excluded on purpose — it is a rendering choice, not a
      // permission, and it is now true for everyone including a null role.
      const { planOnlyCells: _planOnly, ...capabilities } = caps(role);
      expect(Object.values(capabilities).every((v) => v === false)).toBe(true);
    }
  });

  it('no role may edit an actual while the grid is plan-only', () => {
    // `isAdminLike && !planOnlyCells` = (admin|boss) && false. Pinned so that
    // restoring the boss-only rule shows up here as `['admin']` again.
    const allowed = ROLES.filter((r) => caps(r).canEditActual);
    expect(allowed).toEqual([]);
  });
});

describe('planGridCapabilities — closed season', () => {
  it('kills every write capability, admin included', () => {
    for (const role of ROLES) {
      const c = caps(role, true);
      expect(c.canEditTrucks).toBe(false);
      expect(c.canEditActual).toBe(false);
    }
  });

  it('leaves the read-side role facts untouched', () => {
    // `canEditHarvest` / `planOnlyCells` describe who the user is, not what the
    // season allows — the component gates the actual writes on isReadOnly
    // separately (canEditPlanForEntry), and the cell must still render
    // plan-only for boss while browsing a closed season.
    const c = caps('boss', true);
    expect(c.isAdminLike).toBe(true);
    expect(c.canEditHarvest).toBe(true);
    expect(c.planOnlyCells).toBe(true);
  });

  it('does not change canGenerateTasks — the button is disabled by isReadOnly at the call site', () => {
    expect(caps('admin', true).canGenerateTasks).toBe(true);
  });
});
