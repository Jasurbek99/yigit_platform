/**
 * Dynamic permission helpers.
 *
 * Read from the page_permissions / resource_permissions / field_permissions
 * returned by /auth/me/ and cached in the useAuth() hook.
 */
import type { ICurrentUser, UserRole } from '@/types';

// Roles allowed to view archived (soft-deleted) shipment rows, and — per the
// season lifecycle design's §9.1 ruling — archived rows inside a CLOSED
// season a user is browsing read-only. Mirrors
// `ShipmentViewSet._ARCHIVE_VIEW_ROLES` on the backend; keep the two lists in
// sync. Duplicated (not imported) from `pages/export/ShipmentList.tsx`'s own
// copy — `utils/` must not import from `pages/` (module boundary).
const ARCHIVE_VIEW_ROLES: ReadonlyArray<UserRole> = [
  'admin',
  'director',
  'export_manager',
  'finansist',
  'boss',
];

/**
 * Whether this user can see archived rows — used by `ClosedSeasonBanner` to
 * warn that browsing a closed season may show a partial view (D8/§9.1: a
 * closed season bypasses the archive split only for users who ALSO hold this
 * access; everyone else still has archived rows filtered out).
 */
export function hasArchiveAccess(user: ICurrentUser | null): boolean {
  if (!user) return false;
  return user.is_superuser || ARCHIVE_VIEW_ROLES.includes(user.role);
}

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
  if (user.is_superuser) return true;

  const fields = user.field_permissions?.[resource];
  if (!fields || fields.length === 0) return false;

  return fields.includes('*') || fields.includes(fieldName);
}

/**
 * Get the page_code for a given route path.
 * Returns undefined if the route is not mapped.
 */
export function getPageCode(routePath: string): string | undefined {
  return ROUTE_PAGE_MAP[routePath];
}
