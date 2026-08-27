/**
 * Pure helpers behind the single role-first permission editor.
 *
 * Kept free of React and of the API layer so the grouping and change-detection
 * rules can be tested directly — they are the part that decides which of the
 * three PUT endpoints actually fire on save.
 */

export interface IPermFlags {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export const EMPTY_PERM: IPermFlags = { view: false, create: false, edit: false, delete: false };

export const PERM_ACTIONS: (keyof IPermFlags)[] = ['view', 'create', 'edit', 'delete'];

/** {role: {page_code: visible}} */
export type TPageMatrix = Record<string, Record<string, boolean>>;
/** {role: {resource_code: flags}} */
export type TResourceMatrix = Record<string, Record<string, IPermFlags>>;
/** {resource_code: {role: [field_name]}} */
export type TFieldMatrix = Record<string, Record<string, string[]>>;

export interface ICodeLabel {
  code: string;
  label: string;
}

export interface IPageGroup {
  /** Prefix before the first dot; codes without one land in `main`. */
  key: string;
  items: ICodeLabel[];
}

/**
 * Group page codes by their prefix so 46 checkboxes read as a handful of blocks.
 *
 * `export.shipments` -> group `export`; `dashboard` -> group `main`. Group order
 * follows first appearance in `pages`, which is PAGE_REGISTRY order, so the
 * layout stays stable between loads.
 */
export function groupPages(pages: ICodeLabel[]): IPageGroup[] {
  const groups: IPageGroup[] = [];
  const byKey = new Map<string, IPageGroup>();

  for (const page of pages) {
    const dot = page.code.indexOf('.');
    const key = dot === -1 ? 'main' : page.code.slice(0, dot);
    let group = byKey.get(key);
    if (!group) {
      group = { key, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(page);
  }

  return groups;
}

/** How many page checkboxes differ between the saved matrix and the draft. */
export function countPageChanges(
  base: TPageMatrix,
  draft: TPageMatrix | null,
): number {
  if (!draft) return 0;
  let changed = 0;
  for (const role of Object.keys(draft)) {
    const drafted = draft[role] ?? {};
    const saved = base[role] ?? {};
    for (const code of Object.keys(drafted)) {
      if ((drafted[code] ?? false) !== (saved[code] ?? false)) changed += 1;
    }
  }
  return changed;
}

/** How many resource checkboxes differ. Counts each of the 4 actions separately. */
export function countResourceChanges(
  base: TResourceMatrix,
  draft: TResourceMatrix | null,
): number {
  if (!draft) return 0;
  let changed = 0;
  for (const role of Object.keys(draft)) {
    const drafted = draft[role] ?? {};
    const saved = base[role] ?? {};
    for (const code of Object.keys(drafted)) {
      const a = drafted[code] ?? EMPTY_PERM;
      const b = saved[code] ?? EMPTY_PERM;
      for (const action of PERM_ACTIONS) {
        if ((a[action] ?? false) !== (b[action] ?? false)) changed += 1;
      }
    }
  }
  return changed;
}

/**
 * Resource codes whose field grants differ from the saved matrix.
 *
 * The field endpoint saves ONE resource per request, so this list is exactly the
 * set of PUTs the save button must fire — an unchanged resource must not be
 * re-sent, or a concurrent edit by another admin gets clobbered.
 */
export function changedFieldResources(
  base: TFieldMatrix,
  draft: TFieldMatrix | null,
): string[] {
  if (!draft) return [];
  const changed: string[] = [];

  for (const resource of Object.keys(draft)) {
    const draftedRoles = draft[resource] ?? {};
    const savedRoles = base[resource] ?? {};
    const roles = new Set([...Object.keys(draftedRoles), ...Object.keys(savedRoles)]);
    const differs = [...roles].some(
      (role) => !sameFields(draftedRoles[role] ?? [], savedRoles[role] ?? []),
    );
    if (differs) changed.push(resource);
  }

  return changed;
}

/** Field grants are an unordered set — compare them as one. */
function sameFields(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, i) => value === sortedB[i]);
}

/** Pages a role can currently see, out of the total. Drives the "12 of 46" counter. */
export function countVisiblePages(
  matrix: TPageMatrix,
  role: string,
  pages: ICodeLabel[],
): number {
  const row = matrix[role] ?? {};
  return pages.filter((page) => row[page.code]).length;
}

/** Toggle one page for one role, returning a new matrix. */
export function togglePage(
  base: TPageMatrix,
  role: string,
  code: string,
  checked: boolean,
): TPageMatrix {
  return { ...base, [role]: { ...(base[role] ?? {}), [code]: checked } };
}

/** Toggle one action of one resource for one role, returning a new matrix. */
export function toggleResource(
  base: TResourceMatrix,
  role: string,
  code: string,
  action: keyof IPermFlags,
  checked: boolean,
): TResourceMatrix {
  const current = base[role]?.[code] ?? EMPTY_PERM;
  return {
    ...base,
    [role]: { ...(base[role] ?? {}), [code]: { ...current, [action]: checked } },
  };
}

/**
 * Toggle one field grant for one role on one resource.
 *
 * A role holding the `*` wildcard is treated as holding every field; ticking an
 * individual field while `*` is set is a no-op, and that case is disabled in the
 * UI rather than silently expanded into an explicit list.
 */
export function toggleField(
  base: TFieldMatrix,
  resource: string,
  role: string,
  field: string,
  checked: boolean,
): TFieldMatrix {
  const current = base[resource]?.[role] ?? [];
  const next = checked
    ? [...current.filter((f) => f !== field), field]
    : current.filter((f) => f !== field);
  return { ...base, [resource]: { ...(base[resource] ?? {}), [role]: next } };
}

/** Grant or revoke the `*` wildcard for a role on a resource. */
export function toggleAllFields(
  base: TFieldMatrix,
  resource: string,
  role: string,
  checked: boolean,
): TFieldMatrix {
  return {
    ...base,
    [resource]: { ...(base[resource] ?? {}), [role]: checked ? ['*'] : [] },
  };
}
