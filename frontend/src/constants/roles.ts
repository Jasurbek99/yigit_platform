/**
 * Role choices — mirrors backend ROLE_CHOICES in apps/core/roles.py.
 * `labelKey` maps to existing `roles.*` i18n keys in tk/ru/en.json.
 */
import type { UserRole } from '@/types';

/**
 * Task ownership equivalence — mirrors TASK_ROLE_EQUIVALENTS in
 * backend/apps/core/roles.py. A deputy acts with identical authority to their
 * head (stakeholder decision, June 2026), so the head's tasks are the deputies'
 * work: they see them AND may act on them.
 *
 * Deliberately narrow — do NOT widen this to the management hierarchy, which
 * includes weight_master (21 users) who must not receive loading-dept tasks.
 */
const TASK_ROLE_EQUIVALENTS: Readonly<Record<string, readonly string[]>> = {
  loading_dept_head: ['loading_dept_head', 'loading_dept_head_deputy'],
  loading_dept_head_deputy: ['loading_dept_head', 'loading_dept_head_deputy'],
};

/** Roles whose tasks `role` may see and act on; always includes `role` itself. */
export function taskRolesFor(role: string | null | undefined): readonly string[] {
  if (!role) return [];
  return TASK_ROLE_EQUIVALENTS[role] ?? [role];
}

export const ROLE_CHOICES: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: 'export_manager',     labelKey: 'roles.export_manager' },
  { value: 'loading_dept_head',  labelKey: 'roles.loading_dept_head' },
  { value: 'loading_dept_head_deputy', labelKey: 'roles.loading_dept_head_deputy' },
  { value: 'warehouse_chief',    labelKey: 'roles.warehouse_chief' },
  { value: 'weight_master',      labelKey: 'roles.weight_master' },
  { value: 'document_team',      labelKey: 'roles.document_team' },
  { value: 'transport',          labelKey: 'roles.transport' },
  { value: 'sales_rep',          labelKey: 'roles.sales_rep' },
  { value: 'finansist',          labelKey: 'roles.finansist' },
  { value: 'director',           labelKey: 'roles.director' },
  { value: 'accountant',         labelKey: 'roles.accountant' },
  { value: 'greenhouse_manager', labelKey: 'roles.greenhouse_manager' },
  { value: 'seller',             labelKey: 'roles.seller' },
  { value: 'quality_inspector',  labelKey: 'roles.quality_inspector' },
  { value: 'garawul',            labelKey: 'roles.garawul' },
  { value: 'agent',              labelKey: 'roles.agent' },
  { value: 'agent_seller',       labelKey: 'roles.agent_seller' },
  { value: 'boss',               labelKey: 'roles.boss' },
] as const;

/**
 * Document-team ↔ export-manager equivalence — mirrors `EXPORT_MANAGER_LIKE`
 * in backend/apps/core/roles.py (Sep 2026 stakeholder decision). The document
 * team carries the same authority as the export manager on every operational
 * gate, so every client-side role list that names one names the other.
 *
 * The backend is the authority; these lists only decide what a user is SHOWN.
 * Spread this constant into a role array, or call `isExportManagerLike` in an
 * equality chain, rather than adding a second bare literal that can drift.
 */
export const EXPORT_MANAGER_LIKE: readonly string[] = ['export_manager', 'document_team'];

/** True when `role` holds export-manager-level authority. */
export function isExportManagerLike(role: string | null | undefined): boolean {
  return !!role && EXPORT_MANAGER_LIKE.includes(role);
}

/** The agent at a destination market (runs his team in the /m/ app). Mirrors backend AGENT_ROLE. */
export const AGENT_ROLE: UserRole = 'agent';
/** The agent's seller at one bazaar. Mirrors backend AGENT_SELLER_ROLE. */
export const AGENT_SELLER_ROLE: UserRole = 'agent_seller';

/** Agent-market roles: confined to the separate /m/ app, never the internal UI. */
export const EXTERNAL_ROLES: ReadonlyArray<UserRole> = [AGENT_ROLE, AGENT_SELLER_ROLE];

/** ROLE_CHOICES without the agent-market roles — for staff rosters, pickers and row-access grants. */
export const STAFF_ROLE_CHOICES = ROLE_CHOICES.filter(
  (r) => !(EXTERNAL_ROLES as readonly string[]).includes(r.value),
);
