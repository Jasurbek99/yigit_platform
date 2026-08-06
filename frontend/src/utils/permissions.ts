/**
 * Dynamic permission helpers.
 *
 * Read from the page_permissions / resource_permissions / field_permissions
 * returned by /auth/me/ and cached in the useAuth() hook.
 */
import { useUiStore } from '@/stores/uiStore';
import type { ICurrentUser } from '@/types';

// ── Route → page_code mapping ────────────────────────────────────────────

const ROUTE_PAGE_MAP: Record<string, string> = {
  '/':                          'dashboard',
  '/export/shipments':          'export.shipments',
  '/export/shipments/sheet':    'export.shipments',
  '/export/shipments/dashboard':'export.shipments',
  '/export/shipments/board':    'export.shipments.board',
  '/export/harvest-board':      'export.harvest_board',
  '/export/overdue':            'export.overdue',
  '/export/advances':           'export.advances',
  '/export/plan':               'export.plan',
  '/export/quota':              'export.quota',
  '/export/prices':             'export.prices',
  '/export/trucks':             'export.trucks',
  '/export/blocks':             'export.blocks',
  '/export/domestic-sales':     'export.domestic_sales',
  '/export/drafts':             'export.drafts',
  '/export/assign':             'export.assign',
  '/export/pallet-manifest':    'export.pallet_manifest',
  '/export/weightmaster':       'export.pallet_manifest',
  '/admin/users':               'admin.users',
  '/admin/seasons':             'admin.seasons',
  '/admin/firms':               'admin.firms',
  '/admin/import-firms':        'admin.import_firms',
  '/admin/permissions':         'admin.permissions',
  '/admin/blocks':              'admin.blocks',
  '/admin/customers':           'admin.customers',
  '/admin/truck-destinations':  'admin.truck_dest',
  '/admin/shipment-settings':   'admin.shipment_settings',
  '/admin/audit-log':           'audit_log',
  '/admin/staff-access':        'admin.staff_access',
  '/boss/dashboard':            'analytics.boss',
  '/analytics/clients-report':  'analytics.clients',
  '/director/stuck-shipments':  'director.stuck_shipments',
  '/me/board':                  'me.board',
  '/feedback/submit':           'feedback.submit',
  '/feedback/my-tickets':       'feedback.my_tickets',
  '/feedback/public':           'feedback.public',
  '/admin/feedback':            'feedback.admin_inbox',
  '/contracts':                 'contracts.list',
  '/sales':                     'contracts.sales',
  '/documents':                 'contracts.documents',
  '/export/my-reports':         'export.sales_reports',
  '/admin/sales-rep-coverage':  'export.sales_rep_coverage',
  '/admin/expense-template':    'export.expense_template',
  '/admin/packing-templates':   'export.packing_presets',
};

/** Mirrors REFERENCE_DATA_WRITE in backend/apps/core/roles.py. */
const REFERENCE_DATA_WRITE_ROLES = new Set(['admin', 'director', 'export_manager']);

/**
 * Check if a user can see a page/route.
 *
 * @param user  Current user from useAuth(), or null
 * @param pageCodeOrRoute  Either a page_code ('export.shipments') or a route path ('/export/shipments')
 */
export function canSeePage(user: ICurrentUser | null, pageCodeOrRoute: string): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  // Resolve route path to page_code if needed
  const pageCode = ROUTE_PAGE_MAP[pageCodeOrRoute] ?? pageCodeOrRoute;

  // If no page_permissions data yet (first load before /auth/me/ resolves),
  // fail-closed: deny access. ProtectedRoute handles the loading state separately.
  if (!user.page_permissions) {
    return false;
  }

  // Exact match
  if (user.page_permissions[pageCode]) {
    return true;
  }

  // Check child pages: if user has access to any sub-page (e.g. 'export.quota.local_sell'),
  // they should be able to access the parent (e.g. 'export.quota').
  const prefix = pageCode + '.';
  for (const key in user.page_permissions) {
    if (key.startsWith(prefix) && user.page_permissions[key]) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a user can perform an action on a resource.
 */
export function canDo(
  user: ICurrentUser | null,
  resource: string,
  action: 'view' | 'create' | 'edit' | 'delete',
): boolean {
  if (!user) return false;
  // Boss view/edit toggle. MUST precede the is_superuser check below.
  // 'view' is exempt — locking reads would blank the process for him.
  if (user.role === 'boss' && action !== 'view' && !useUiStore.getState().bossEditMode) {
    return false;
  }
  if (user.is_superuser) return true;

  const perm = user.resource_permissions?.[resource];
  if (!perm) return false;

  return perm[action] ?? false;
}

/**
 * Check if a user can edit a specific field on a resource.
 */
export function canEditField(
  user: ICurrentUser | null,
  resource: string,
  fieldName: string,
): boolean {
  if (!user) return false;
  // Boss view/edit toggle. MUST precede the is_superuser check below.
  if (user.role === 'boss' && !useUiStore.getState().bossEditMode) return false;
  if (user.is_superuser) return true;

  const fields = user.field_permissions?.[resource];
  if (!fields || fields.length === 0) return false;

  return fields.includes('*') || fields.includes(fieldName);
}

/**
 * `canDo`, forced to `false` for the boss.
 *
 * Several write endpoints hard-code a role allowlist and never consult the
 * permission matrix — `PRIVILEGED_ROLES` on shipment create (export/views.py),
 * `LOCAL_SELL_WRITE` on the local sell plan, `REFERENCE_DATA_WRITE` on
 * reference data. The boss's 2026-08-05 matrix CRUD grant satisfies none of
 * them, so a control guarded by `canDo` alone renders for him and then 403s.
 * Use this wherever that is the case, so the UI never promises what the API
 * refuses. No other role's decision changes.
 */
export function canDoBackendGated(
  user: ICurrentUser | null,
  resource: string,
  action: 'view' | 'create' | 'edit' | 'delete',
): boolean {
  if (user?.role === 'boss') return false;
  return canDo(user, resource, action);
}

/**
 * Whether the backend's `REFERENCE_DATA_WRITE` gate (backend/apps/core/roles.py)
 * accepts this user. Countries, cities, customers and shipment status types are
 * gated by that role list alone — they have no permission-matrix resource — so
 * pages editing them cannot use `canDo` at all.
 */
export function canWriteReferenceData(user: ICurrentUser | null): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  return REFERENCE_DATA_WRITE_ROLES.has(user.role);
}

/**
 * Get the page_code for a given route path.
 * Returns undefined if the route is not mapped.
 */
export function getPageCode(routePath: string): string | undefined {
  return ROUTE_PAGE_MAP[routePath];
}

/**
 * Every real app route path, for use as autocomplete suggestions in free-text
 * route pickers (e.g. the process-node-link admin page) — NOT for gating.
 * Deliberately does not add an entry to ROUTE_PAGE_MAP itself: that map drives
 * canSeePage()'s permission-matrix resolution, and this route is intentionally
 * role-gated instead (see ProcessNodeLinksPage).
 */
export function getKnownAppRoutes(): string[] {
  return Object.keys(ROUTE_PAGE_MAP);
}
