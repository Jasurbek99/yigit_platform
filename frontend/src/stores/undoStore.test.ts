import { describe, it, expect, beforeEach } from 'vitest';
import { useUndoStore, type IUndoEntry, type IUndoEntryInput } from './undoStore';

function reset(): void {
  useUndoStore.setState({ past: [], isUndoing: false, nextId: 1 });
}

function cellEntry(rowKey: string, before: unknown, after: unknown): IUndoEntryInput {
  return { kind: 'cell', shipmentId: 1, rowKey, before, after };
}

/** Narrow an entry to its cell variant for assertions. */
function rowKeyOf(entry: IUndoEntry | undefined): string | undefined {
  return entry && entry.kind === 'cell' ? entry.rowKey : undefined;
}

describe('undoStore', () => {
  beforeEach(reset);

  it('pushUndo assigns incrementing ids and returns them', () => {
    const a = useUndoStore.getState().pushUndo(cellEntry('notes', 'x', 'y'));
    const b = useUndoStore.getState().pushUndo(cellEntry('notes', 'y', 'z'));
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(useUndoStore.getState().past).toHaveLength(2);
  });

  it('popUndo returns the most-recent entry (LIFO) and shrinks the stack', () => {
    useUndoStore.getState().pushUndo(cellEntry('a', 1, 2));
    useUndoStore.getState().pushUndo(cellEntry('b', 3, 4));
    const top = useUndoStore.getState().popUndo();
    expect(rowKeyOf(top)).toBe('b');
    expect(useUndoStore.getState().past).toHaveLength(1);
    const next = useUndoStore.getState().popUndo();
    expect(rowKeyOf(next)).toBe('a');
    expect(useUndoStore.getState().popUndo()).toBeUndefined();
  });

  it('pushUndo no-ops (returns -1) while isUndoing — prevents the reverse from re-capturing', () => {
    useUndoStore.setState({ isUndoing: true });
    const id = useUndoStore.getState().pushUndo(cellEntry('a', 1, 2));
    expect(id).toBe(-1);
    expect(useUndoStore.getState().past).toHaveLength(0);
  });

  it('trims to the MAX_UNDO bound (50), dropping the oldest', () => {
    for (let i = 0; i < 60; i++) {
      useUndoStore.getState().pushUndo(cellEntry(`r${i}`, i, i + 1));
    }
    const { past } = useUndoStore.getState();
    expect(past).toHaveLength(50);
    // Oldest kept is r10 (r0..r9 dropped); newest is r59.
    expect(rowKeyOf(past[0])).toBe('r10');
    expect(rowKeyOf(past[past.length - 1])).toBe('r59');
  });

  it('removeUndo drops only the targeted entry', () => {
    const a = useUndoStore.getState().pushUndo(cellEntry('a', 1, 2));
    const b = useUndoStore.getState().pushUndo(cellEntry('b', 3, 4));
    useUndoStore.getState().removeUndo(a);
    const { past } = useUndoStore.getState();
    expect(past).toHaveLength(1);
    expect(past[0].id).toBe(b);
  });

  it('patchAfter updates only the targeted cell entry (after + cascade)', () => {
    const a = useUndoStore.getState().pushUndo(cellEntry('a', 1, 'sent'));
    const b = useUndoStore.getState().pushUndo(cellEntry('b', 3, 'sent'));
    useUndoStore.getState().patchAfter(a, 'reconciled', { from: 'draft', to: 'gumruk_girish' });
    const past = useUndoStore.getState().past;
    const entryA = past.find((e) => e.id === a);
    const entryB = past.find((e) => e.id === b);
    expect(entryA?.kind === 'cell' && entryA.after).toBe('reconciled');
    expect(entryA?.kind === 'cell' && entryA.cascade?.to).toBe('gumruk_girish');
    expect(entryB?.kind === 'cell' && entryB.after).toBe('sent'); // untouched
  });

  it('patchAfter keeps the provisional after when the reconciled value is undefined', () => {
    // A field the server omitted from the PATCH response → reconciled undefined.
    // Overwriting `after` with undefined would later false-positive "cell changed".
    const id = useUndoStore.getState().pushUndo(cellEntry('a', 'old', 'sent'));
    useUndoStore.getState().patchAfter(id, undefined, { from: 'draft', to: 'gumruk_girish' });
    const entry = useUndoStore.getState().past.find((e) => e.id === id);
    expect(entry?.kind === 'cell' && entry.after).toBe('sent'); // preserved
    expect(entry?.kind === 'cell' && entry.cascade?.to).toBe('gumruk_girish'); // still applied
  });

  it('clearUndo empties the stack', () => {
    useUndoStore.getState().pushUndo(cellEntry('a', 1, 2));
    useUndoStore.getState().clearUndo();
    expect(useUndoStore.getState().past).toHaveLength(0);
  });
});
