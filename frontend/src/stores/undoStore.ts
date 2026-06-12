import { create } from 'zustand';

// ─── Sheet undo stack (Ctrl+Z) ─────────────────────────────────────────────
// A bounded LIFO history of cell writes. Each entry is a closure-free typed
// descriptor keyed by its REVERSE mechanism, so undo dispatch + the descriptors
// stay debuggable and unit-testable. Undo restores the cell VALUE only — it
// cannot reverse server side effects an edit triggered (status auto-advance,
// AD-1 timestamps, notifications, tasks); the lifecycle is forward-only.

/** When the original edit advanced the shipment status. Used for the warn-on-undo toast. */
export interface IUndoCascade {
  from: string | null;
  to: string | null;
}

export type IUndoEntry =
  // scalar single-field + custom_* + FK — all reverse through writeCell()
  | {
      id: number;
      kind: 'cell';
      shipmentId: number;
      rowKey: string;
      before: unknown;
      after: unknown;
      cascade?: IUndoCascade;
    }
  // the R26 virtual transit_days_temp cell — reverses via patchMulti()
  | {
      id: number;
      kind: 'multi';
      shipmentId: number;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      cascade?: IUndoCascade;
    }
  // firm_splits / block_sources junctions — before is the cached code array
  | {
      id: number;
      kind: 'junction';
      shipmentId: number;
      field: 'firm_splits' | 'block_sources';
      before: Array<{ firm_code?: string; block_code?: string }>;
    }
  // R38 varieties_dominant M2M — before is the cached {id,name} list
  | {
      id: number;
      kind: 'varieties';
      shipmentId: number;
      before: Array<{ id: number; name: string }>;
    };

// Distributive Omit so each union member keeps its own discriminant-specific
// props (a plain Omit<IUndoEntry,'id'> collapses the union to common props only).
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type IUndoEntryInput = DistributiveOmit<IUndoEntry, 'id'>;

const MAX_UNDO = 50;

interface IUndoState {
  past: IUndoEntry[];
  // True while applyUndo is replaying a reverse write. The reverse goes through
  // a capturing path (writeCell), so pushUndo MUST no-op while this is set or
  // the stack ping-pongs forever.
  isUndoing: boolean;
  nextId: number;
  /** Push a new entry. Returns its id, or -1 when suppressed (during undo). */
  pushUndo: (entry: IUndoEntryInput) => number;
  /** Drop an entry whose optimistic write rolled back (per-call onError). */
  removeUndo: (id: number) => void;
  /** Install the reconciled `after` (+ optional cascade) once onSuccess lands. */
  patchAfter: (id: number, after: unknown, cascade?: IUndoCascade) => void;
  /** Pop the most-recent entry (LIFO) for replay. */
  popUndo: () => IUndoEntry | undefined;
  setUndoing: (value: boolean) => void;
  clearUndo: () => void;
}

export const useUndoStore = create<IUndoState>((set, get) => ({
  past: [],
  isUndoing: false,
  nextId: 1,

  pushUndo: (entry) => {
    if (get().isUndoing) return -1;
    const id = get().nextId;
    set((s) => ({
      nextId: s.nextId + 1,
      past: [...s.past, { ...entry, id } as IUndoEntry].slice(-MAX_UNDO),
    }));
    return id;
  },

  removeUndo: (id) => set((s) => ({ past: s.past.filter((e) => e.id !== id) })),

  patchAfter: (id, after, cascade) =>
    set((s) => ({
      past: s.past.map((e) => {
        if (e.id !== id) return e;
        // Keep the provisional `after` when the server didn't echo this field
        // (reconciled === undefined): overwriting it would make the next undo's
        // concurrent guard false-positive "cell changed". Cascade still applies.
        if (e.kind === 'cell') {
          return { ...e, after: after === undefined ? e.after : after, ...(cascade ? { cascade } : {}) };
        }
        if (e.kind === 'multi') {
          return {
            ...e,
            after: after === undefined ? e.after : (after as Record<string, unknown>),
            ...(cascade ? { cascade } : {}),
          };
        }
        return e; // junction / varieties carry no reconciled after
      }),
    })),

  popUndo: () => {
    const { past } = get();
    if (past.length === 0) return undefined;
    const entry = past[past.length - 1];
    set({ past: past.slice(0, -1) });
    return entry;
  },

  setUndoing: (value) => set({ isUndoing: value }),
  clearUndo: () => set({ past: [] }),
}));
