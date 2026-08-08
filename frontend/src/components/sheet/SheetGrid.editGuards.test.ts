import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Structural guard, deliberately not a behavioural one.
 *
 * The defect this exists for was never in `isCellEditable` — that predicate
 * was correct. It was that two call sites in SheetGrid opened the editor
 * without asking it: the Enter and type-to-edit keyboard paths checked only
 * `input_type` and `isSeasonReadOnly`, re-deriving a SUBSET of the predicate
 * and so missing the boss's view-mode guard. A boss with a cell already
 * selected could press Enter and edit while the header read "Просмотр".
 *
 * A behavioural test would have to mount SheetGrid with dnd-kit, the sheet
 * store, and five hooks, then drive real key events — expensive and brittle
 * against changes that have nothing to do with this invariant. What actually
 * needs protecting is narrow and structural: no path may mount the editor
 * without consulting the shared predicate. That is what this asserts.
 */
// vitest runs with cwd = frontend/.
const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/sheet/SheetGrid.tsx'),
  'utf-8',
);

/** Lines that open the editor, with the preceding lines that guard them. */
function editorOpeningSites(): { line: number; guardWindow: string }[] {
  const lines = SOURCE.split('\n');
  const sites: { line: number; guardWindow: string }[] = [];
  lines.forEach((line, i) => {
    if (!line.includes('setEditingCell(')) return;
    // The guard is the `if (...)` immediately above the call. Six lines is
    // enough for a multi-line condition without reaching the previous block.
    sites.push({ line: i + 1, guardWindow: lines.slice(Math.max(0, i - 6), i + 1).join('\n') });
  });
  return sites;
}

describe('SheetGrid editor-opening paths', () => {
  it('has at least the keyboard and click paths, so this test cannot pass vacuously', () => {
    expect(editorOpeningSites().length).toBeGreaterThanOrEqual(2);
  });

  it('never mounts the editor without consulting isCellEditable', () => {
    const unguarded = editorOpeningSites().filter(
      (site) => !site.guardWindow.includes('isCellEditable'),
    );
    expect(
      unguarded.map((s) => `SheetGrid.tsx:${s.line}`),
    ).toEqual([]);
  });

  it('does not re-derive editability from input_type alone', () => {
    // `input_type !== 'readonly'` as a standalone gate is the exact shape of
    // the original defect: it looks like an editability check and is only a
    // fragment of one. isCellEditable already covers readonly rows.
    const fragments = SOURCE.split('\n').filter(
      (line) => line.includes("input_type !== 'readonly'"),
    );
    expect(fragments).toEqual([]);
  });
});
