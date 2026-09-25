import { describe, it, expect } from 'vitest';
import { getStatusStepsForShipment } from './RouteTimelineRail';

/**
 * A Gapy-Satyş truck is a domestic gate sale: it completes at `yuklenme` +
 * departure and never crosses a border, clears destination customs, arrives
 * or produces a sales report (ADR-025). The rail marks every step before the
 * current one as done, so leaving the export steps in the list would put a
 * green ✓ on seven events that never happened.
 */
describe('getStatusStepsForShipment — Gapy-Satyş', () => {
  it('stops the route at loading and jumps to completion', () => {
    const steps = getStatusStepsForShipment(false, true).map((s) => s.code);
    expect(steps).toEqual([
      'draft',
      'gumruk_girish',
      'gumruk_chykysh',
      'yuklenme',
      'tamamlandy',
    ]);
  });

  it('never shows road, destination or sales steps for a gapy truck', () => {
    const steps = getStatusStepsForShipment(false, true).map((s) => s.code);
    for (const code of [
      'yola_chykdy',
      'serhet_gechdi',
      'dest_entry',
      'barysh_gumrugi',
      'transshipment',
      'bardy',
      'satylyar',
      'satyldy',
    ]) {
      expect(steps).not.toContain(code);
    }
  });

  it('ignores has_peregruz for a gapy truck — it never reaches that fork', () => {
    expect(getStatusStepsForShipment(true, true).map((s) => s.code)).toEqual(
      getStatusStepsForShipment(false, true).map((s) => s.code),
    );
  });

  it('leaves a normal export truck untouched', () => {
    const steps = getStatusStepsForShipment(false, false).map((s) => s.code);
    expect(steps).toContain('yola_chykdy');
    expect(steps).toContain('satyldy');
    expect(steps).not.toContain('transshipment');
    expect(steps[steps.length - 1]).toBe('tamamlandy');
  });

  it('still inserts transshipment for a normal truck with peregruz', () => {
    const steps = getStatusStepsForShipment(true, false).map((s) => s.code);
    expect(steps.indexOf('transshipment')).toBe(steps.indexOf('barysh_gumrugi') + 1);
  });
});
